// Ollama's OpenAI endpoint does not implement keep_alive or num_ctx.
// Use its native endpoint when selected, retaining the existing completion shape.
// Inference may live on another machine. A circuit breaker keeps a dead or saturated backend from turning
// every tick into a multi-minute wait: after `openAfter` consecutive transport failures the circuit opens for
// `openMs` and callers fail fast; one probe is allowed through when it half-opens. `health()` reports it.
export function createLocalChatTransport({ url, model, key = '', keepAlive = '2m',
  transport = 'openai', contextSize = 8192, timeoutMs = 180_000, openAfter = 3, openMs = 60_000, log = console } = {}) {
  if (!['openai', 'ollama'].includes(transport)) throw new Error('Unsupported local chat transport');
  if (!Number.isInteger(contextSize) || contextSize < 1024 || contextSize > 32768) {
    throw new Error('Local context size must be an integer from 1024 to 32768');
  }
  const base = String(url).replace(/\/+$/, '');
  const circuit = { failures: 0, openUntil: 0, probing: false, lastError: null, lastSuccessAt: null, lastFailureAt: null, opened: 0 };
  const isTransportFailure = e => /timed out|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|HTTP 5\d\d|socket hang up|aborted/i.test(String(e?.message || e));
  function record(ok, e = null) {
    if (ok) { if (circuit.failures >= openAfter) log.warn?.(`[inference] backend recovered after ${circuit.failures} failures`); circuit.failures = 0; circuit.openUntil = 0; circuit.probing = false; circuit.lastSuccessAt = Date.now(); return; }
    circuit.lastError = String(e?.message || e).slice(0, 200); circuit.lastFailureAt = Date.now(); circuit.probing = false;
    if (!isTransportFailure(e)) return;
    circuit.failures++;
    if (circuit.failures >= openAfter && Date.now() >= circuit.openUntil) {
      circuit.openUntil = Date.now() + openMs; circuit.opened++;
      log.warn?.(`[inference] circuit open for ${openMs / 1000}s after ${circuit.failures} consecutive failures: ${circuit.lastError}`);
    }
  }
  const health = () => ({ backend: base, transport, model, state: Date.now() < circuit.openUntil ? 'open' : circuit.failures >= openAfter ? 'half_open' : 'closed',
    consecutiveFailures: circuit.failures, lastError: circuit.lastError, lastSuccessAt: circuit.lastSuccessAt, lastFailureAt: circuit.lastFailureAt, timesOpened: circuit.opened });
  async function create(opts, { signal, timeoutMs: callTimeoutMs } = {}) {
    if (Date.now() < circuit.openUntil) throw Object.assign(new Error(`inference circuit open (${circuit.lastError}); retry after ${Math.ceil((circuit.openUntil - Date.now()) / 1000)}s`), { code: 'CIRCUIT_OPEN' });
    if (circuit.failures >= openAfter) { if (circuit.probing) throw Object.assign(new Error('inference circuit half-open; a probe is in flight'), { code: 'CIRCUIT_OPEN' }); circuit.probing = true; }
    try { const r = await request(opts, { signal, timeoutMs: callTimeoutMs }); record(true); return r; }
    catch (e) { record(false, e); throw e; }
  }
  create.health = health;
  return create;
  async function request(opts, { signal, timeoutMs: callTimeoutMs } = {}) {
    let body = { ...opts, model, stream: false };
    if (transport === 'ollama') {
      if (opts.tools?.length) throw new Error('Native OCA chat does not dispatch model tools');
      const messages = (opts.messages || []).map(message => {
        const parts = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }];
        if (parts.some(part => part.type !== 'text' || typeof part.text !== 'string')) {
          throw new Error('Native OCA chat requires text; use the vision transport for images');
        }
        return { role: message.role, content: parts.map(part => part.text).join('\n') };
      });
      const format = opts.response_format?.type === 'json_schema'
        ? opts.response_format.json_schema?.schema
        : opts.response_format?.type === 'json_object' ? 'json' : undefined;
      if (opts.response_format && !format) throw new Error('Unsupported native response format');
      const residency = typeof keepAlive === 'string' && /^-?\d+(?:\.\d+)?$/.test(keepAlive)
        ? Number(keepAlive) : keepAlive;
      body = { model, messages, stream: false, think: false, keep_alive: residency,
        truncate: false, shift: false,
        options: { num_ctx: contextSize, num_predict: opts.max_completion_tokens ?? opts.max_tokens ?? 2000,
          temperature: opts.temperature ?? 0.3, ...(opts.stop ? { stop: opts.stop } : {}) },
        ...(format ? { format } : {}) };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Local inference timed out')), Number.isFinite(callTimeoutMs) && callTimeoutMs > 0 ? callTimeoutMs : timeoutMs);
    try {
      const response = await fetch(`${base}${transport === 'ollama' ? '/api/chat' : '/v1/chat/completions'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
      if (!response.ok) throw new Error(`Local inference HTTP ${response.status}: ${await response.text()}`);
      const data = await response.json();
      if (transport === 'openai') return data;
      if (data.error || data.done !== true || typeof data.message?.content !== 'string' || !data.message.content.trim()) {
        throw new Error(`Incomplete native inference response: ${data.error || data.done_reason || 'no final content'}`);
      }
      return { id: `ollama-${data.created_at}`, model: data.model, object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: data.message.content },
          finish_reason: data.done_reason === 'length' ? 'length' : 'stop' }],
        usage: { prompt_tokens: data.prompt_eval_count || 0, completion_tokens: data.eval_count || 0,
          total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0) },
        timings: { total_ns: data.total_duration, load_ns: data.load_duration,
          prompt_ns: data.prompt_eval_duration, generation_ns: data.eval_duration } };
    } finally { clearTimeout(timer); }
  }
}
