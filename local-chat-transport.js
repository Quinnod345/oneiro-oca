// Ollama's OpenAI endpoint does not implement keep_alive or num_ctx.
// Use its native endpoint when selected, retaining the existing completion shape.
export function createLocalChatTransport({ url, model, key = '', keepAlive = '2m',
  transport = 'openai', contextSize = 8192, timeoutMs = 180_000 } = {}) {
  if (!['openai', 'ollama'].includes(transport)) throw new Error('Unsupported local chat transport');
  if (!Number.isInteger(contextSize) || contextSize < 1024 || contextSize > 32768) {
    throw new Error('Local context size must be an integer from 1024 to 32768');
  }
  const base = String(url).replace(/\/+$/, '');
  return async function create(opts, { signal } = {}) {
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
    const timer = setTimeout(() => controller.abort(new Error('Local inference timed out')), timeoutMs);
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
  };
}
