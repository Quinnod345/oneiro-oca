// Generated predictions are not measured outcomes. Unavailable inference must
// remain unavailable; repeating the prompt is not a simulation.
export const simulationSchema = {
  type: 'object', additionalProperties: false,
  required: ['predicted_states', 'branch_points', 'risks', 'expected_outcome'],
  properties: {
    predicted_states: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['step', 'state', 'confidence'], properties: {
        step: { type: 'integer' }, state: { type: 'string' }, confidence: { type: 'number' } } } },
    branch_points: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['step', 'description', 'alternatives'], properties: {
        step: { type: 'integer' }, description: { type: 'string' },
        alternatives: { type: 'array', items: { type: 'string' } } } } },
    risks: { type: 'array', items: { type: 'string' } }, expected_outcome: { type: 'string' }
  }
};
export function analysisUnavailable(reason) {
  return { quality: 'analysis_unavailable', reason, predicted_states: [], branch_points: [], risks: [], expected_outcome: '' };
}
// A bounded warning, not proof of semantic grounding. Only narrative numeric
// literals are compared with supplied assumptions; step/confidence metadata is
// excluded. Original predictions and receipts are never rewritten.
export function simulationGrounding(result, input = {}) {
  const numbers = text => [...new Set((String(text).match(/(?<![\p{L}\p{N}_])[+-]?\d+(?:,\d{3})*(?:\.\d+)?%?/gu) || [])
    .map(n => n.replaceAll(',', '')))];
  const supplied = new Set(numbers(JSON.stringify(input)));
  const items = v => Array.isArray(v) ? v : [];
  const narrative = [result?.expected_outcome, ...items(result?.risks),
    ...items(result?.predicted_states).map(s => s?.state),
    ...items(result?.branch_points).flatMap(b => [b?.description, ...items(b?.alternatives)])];
  const unsupportedQuantities = numbers(narrative.join(' ')).filter(n => !supplied.has(n));
  return { status: 'not_independently_verified', unsupportedQuantities,
    note: 'Unprovided numeric literals are flagged. Matching a supplied number does not verify its use, and qualitative claims still require evidence.' };
}
export function simulationQuality(result) {
  if (!result || result.quality === 'analysis_unavailable' ||
      typeof result.expected_outcome !== 'string' || !result.expected_outcome.trim() ||
      !Array.isArray(result.predicted_states) || !result.predicted_states.length ||
      /^Heuristic simulation fallback:/i.test(result.expected_outcome || '') ||
      (Array.isArray(result.risks) && result.risks.some(r => /^simulation_(llm_unavailable|output_parse_failure|storage_failure)$/.test(r)))) return 'analysis_unavailable';
  return 'generated_prediction';
}
export function parseSimulation(raw, description) {
  try {
    const r = JSON.parse(String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    const text = v => typeof v === 'string' && v.trim().length > 0;
    if (!text(r.expected_outcome) || r.expected_outcome.trim() === String(description).trim() ||
        !Array.isArray(r.predicted_states) || !r.predicted_states.length ||
        !r.predicted_states.every(s => Number.isInteger(s.step) && s.step > 0 && text(s.state) && Number.isFinite(s.confidence) && s.confidence >= 0 && s.confidence <= 1) ||
        !Array.isArray(r.branch_points) || !r.branch_points.every(b => Number.isInteger(b.step) && b.step > 0 && text(b.description) && Array.isArray(b.alternatives) && b.alternatives.length >= 2 && b.alternatives.every(text)) ||
        !Array.isArray(r.risks) || !r.risks.every(text) || simulationQuality(r) === 'analysis_unavailable') {
      return analysisUnavailable('The model did not return a usable scenario. No prediction was recorded.');
    }
    return { quality: 'generated_prediction', predicted_states: r.predicted_states, branch_points: r.branch_points, risks: r.risks, expected_outcome: r.expected_outcome };
  } catch { return analysisUnavailable('The model response could not be read. No prediction was recorded.'); }
}
export function createForwardSimulator({ generate, save }) {
  return async function simulate(description, initialState, actionSequence, { purpose = 'decision' } = {}) {
    let result;
    try {
      const response = await generate({
        system: `Explore a hypothetical scenario. Use the supplied initial state and actions only as assumptions, never as observed results. Keep the entire answer under 140 words: two specific predicted states, one branch comparing two alternatives, up to two risks and a concise expected outcome. If no action sequence is supplied, compare plausible choices in branch_points. Do not invent quantities, named files, measurements, or completed checks. Where details are unknown, describe conditional qualitative possibilities. Confidence is your estimate, not measured accuracy. Return JSON matching the supplied schema.`,
        messages: [{ role: 'user', content: JSON.stringify({ description, initialState, actionSequence, purpose }) }],
        max_tokens: 600, temperature: 0.2
      }, { priority: 10, signal: AbortSignal.timeout(360000), responseSchema: simulationSchema });
      result = parseSimulation(response.content?.[0]?.text, description);
    } catch {
      return analysisUnavailable('The reasoning service could not complete this scenario. No prediction was recorded.');
    }
    if (result.quality === 'analysis_unavailable') return result;
    try { return { id: await save({ description, initialState, actionSequence, purpose, result }), ...result }; }
    catch { return analysisUnavailable('The prediction could not be stored. No completed scenario is available.'); }
  };
}
