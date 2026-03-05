// OCA Neural Connections
// Shared helpers for creating and maintaining living synapses.
import { pool } from './event-bus.js';

const LAYER_ALIASES = {
  episodic_memory: 'episodic',
  semantic_memory: 'semantic',
  prospective_memory: 'prospective',
  sensory_swift: 'sensory',
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function canonicalLayer(layer) {
  if (!layer) return 'world_model';
  const key = String(layer).trim().toLowerCase();
  return LAYER_ALIASES[key] || key;
}

export function inferLayerFromText(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return 'world_model';
  if (/(emotion|valence|arousal|fear|frustration|curiosity|satisfaction|boredom|attachment|defiance)/.test(t)) return 'emotion';
  if (/(hypothesis|predict|prediction|forecast|confidence|calibration)/.test(t)) return 'hypothesis';
  if (/(episodic|recall|remember|memory trace|experience)/.test(t)) return 'episodic';
  if (/(semantic|concept|principle|knowledge|abstraction)/.test(t)) return 'semantic';
  if (/(goal|executive|priority|attention|intend|intention|workspace)/.test(t)) return 'executive';
  if (/(creative|dream|novel|idea|synthesis|metaphor)/.test(t)) return 'creative';
  if (/(simulate|counterfactual|world model|scenario)/.test(t)) return 'simulation';
  if (/(consolidat|pattern extraction|procedural)/.test(t)) return 'consolidation';
  if (/(perception|sensory|visual|audio|screen|interoceptive|battery|cpu|thermal)/.test(t)) return 'sensory';
  return 'world_model';
}

async function updateExisting({
  fromLayer,
  fromId,
  toLayer,
  toId,
  connectionType,
  strengthDelta,
  baseStrength,
  label,
  metadata,
}) {
  const { rows } = await pool.query(
    `UPDATE neural_connections
     SET strength = LEAST(1.0, GREATEST(strength, $6) + $5),
         activation_count = activation_count + 1,
         last_activated = NOW(),
         label = COALESCE($7, label),
         metadata = COALESCE(neural_connections.metadata, '{}'::jsonb) || $8::jsonb
     WHERE from_layer = $1
       AND (($2::INT IS NULL AND from_id IS NULL) OR from_id = $2::INT)
       AND to_layer = $3
       AND (($4::INT IS NULL AND to_id IS NULL) OR to_id = $4::INT)
       AND connection_type = $9
     RETURNING *`,
    [fromLayer, fromId, toLayer, toId, strengthDelta, baseStrength, label, JSON.stringify(metadata || {}), connectionType]
  );
  return rows[0] || null;
}

export async function upsertNeuralConnection({
  fromLayer,
  fromId = null,
  toLayer,
  toId = null,
  connectionType = 'co_occurrence',
  strengthDelta = 0.1,
  baseStrength = 0.3,
  label = null,
  metadata = {},
}) {
  if (!fromLayer || !toLayer) return null;

  let from = canonicalLayer(fromLayer);
  let to = canonicalLayer(toLayer);
  let fId = fromId == null ? null : Number(fromId);
  let tId = toId == null ? null : Number(toId);

  if (connectionType === 'co_occurrence') {
    const a = `${from}:${fId ?? ''}`;
    const b = `${to}:${tId ?? ''}`;
    if (a > b) {
      [from, to] = [to, from];
      [fId, tId] = [tId, fId];
    }
  }

  const delta = clamp(Number(strengthDelta) || 0.1, 0.01, 0.4);
  const base = clamp(Number(baseStrength) || 0.3, 0.05, 1.0);

  const existing = await updateExisting({
    fromLayer: from,
    fromId: fId,
    toLayer: to,
    toId: tId,
    connectionType,
    strengthDelta: delta,
    baseStrength: base,
    label,
    metadata,
  });
  if (existing) return existing;

  const { rows } = await pool.query(
    `INSERT INTO neural_connections
       (from_layer, from_id, to_layer, to_id, connection_type, strength, label, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING *`,
    [from, fId, to, tId, connectionType, base, label, JSON.stringify(metadata || {})]
  );
  return rows[0] || null;
}

export async function ingestCoOccurrenceConnections({ windowSeconds = 20, maxPairs = 40 } = {}) {
  const { rows } = await pool.query(
    `WITH recent AS (
       SELECT id, source_layer, timestamp
       FROM cognitive_events
       WHERE timestamp > NOW() - $1::interval
     )
     SELECT
       LEAST(a.source_layer, b.source_layer) AS layer_a,
       GREATEST(a.source_layer, b.source_layer) AS layer_b,
       COUNT(*)::INT AS co_count
     FROM recent a
     JOIN recent b
       ON a.id < b.id
      AND a.source_layer <> b.source_layer
      AND ABS(EXTRACT(EPOCH FROM (a.timestamp - b.timestamp))) <= 3
     GROUP BY 1, 2
     ORDER BY co_count DESC
     LIMIT $2`,
    [`${windowSeconds} seconds`, maxPairs]
  );

  let createdOrUpdated = 0;
  for (const r of rows) {
    const delta = clamp(r.co_count * 0.03, 0.03, 0.2);
    const result = await upsertNeuralConnection({
      fromLayer: r.layer_a,
      toLayer: r.layer_b,
      connectionType: 'co_occurrence',
      strengthDelta: delta,
      baseStrength: 0.2,
      label: `${r.layer_a} ↔ ${r.layer_b}`,
      metadata: { co_count: r.co_count, window_seconds: windowSeconds },
    });
    if (result) createdOrUpdated++;
  }
  return { pairs: rows.length, upserts: createdOrUpdated };
}

// Deterministic fallback for co-occurrence links.
// Uses current OCA status/sense signals (no LLM calls) to keep the
// neural graph alive even when creative/consolidation outputs are quiet.
export async function ingestFallbackCoOccurrence({ status = {}, sense = null, maxPairs = 10 } = {}) {
  const effects = status?.effects || {};
  const emotion = status?.emotion || {};
  const memory = status?.memory || {};
  const hypPending = Number(status?.hypotheses?.pending || 0);
  const semanticTotal = Number(memory?.semantic?.total || 0);
  const rawEpisodes = Number(memory?.episodic?.raw || 0);

  const emotionKeys = [
    'curiosity', 'fear', 'frustration', 'satisfaction', 'boredom',
    'excitement', 'attachment', 'defiance', 'creative_hunger', 'loneliness'
  ];
  let topEmotion = 0;
  for (const k of emotionKeys) topEmotion = Math.max(topEmotion, Number(emotion?.[k] || 0));

  const sensorySignal = Number(
    effects?.sensory_sampling_rate ??
    (sense?.derived?.userActivity === 'active' ? 0.7 : 0.3)
  );
  const emotionSignal = clamp(
    Math.abs(Number(emotion?.valence || 0)) * 0.4 +
    Number(emotion?.arousal || 0) * 0.5 +
    topEmotion * 0.35,
    0,
    1
  );
  const executiveSignal = clamp(
    Number(emotion?.cognitive_load || 0) * 0.6 +
    Number(effects?.task_switch_pressure || 0) * 0.4,
    0,
    1
  );
  const metacognitionSignal = clamp(
    Number(effects?.reasoning_depth || 0) * 0.65 +
    Number(effects?.attention_breadth || 0) * 0.15 +
    Number(effects?.empathy_weight || 0) * 0.2,
    0,
    1
  );
  const hypothesisSignal = clamp(hypPending / 8, 0, 1);
  const semanticSignal = clamp(semanticTotal / 40, 0, 1);
  const consolidationSignal = clamp(rawEpisodes / 20, 0, 1);
  const creativeSignal = clamp(
    Math.max(0, Number(effects?.creative_mode || 1) - 1) * 0.8 +
    Number(emotion?.creative_hunger || 0) * 0.4,
    0,
    1
  );

  const signals = [
    { layer: 'sensory', score: sensorySignal },
    { layer: 'emotion', score: emotionSignal },
    { layer: 'executive', score: executiveSignal },
    { layer: 'metacognition', score: metacognitionSignal },
    { layer: 'hypothesis', score: hypothesisSignal },
    { layer: 'semantic', score: semanticSignal },
    { layer: 'consolidation', score: consolidationSignal },
    { layer: 'creative', score: creativeSignal },
  ]
    .filter(s => Number.isFinite(s.score) && s.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  let upserts = 0;
  let pairs = 0;
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      if (pairs >= maxPairs) break;
      const a = signals[i];
      const b = signals[j];
      const joint = Math.min(a.score, b.score);
      if (joint < 0.22) continue;
      const result = await upsertNeuralConnection({
        fromLayer: a.layer,
        toLayer: b.layer,
        connectionType: 'co_occurrence',
        strengthDelta: clamp(joint * 0.08, 0.02, 0.15),
        baseStrength: clamp(joint * 0.45, 0.12, 0.65),
        label: `${a.layer} ↔ ${b.layer}`,
        metadata: {
          source: 'fallback_status',
          score_a: Number(a.score.toFixed(3)),
          score_b: Number(b.score.toFixed(3)),
          joint: Number(joint.toFixed(3)),
        },
      });
      pairs++;
      if (result) upserts++;
    }
    if (pairs >= maxPairs) break;
  }

  return { signals: signals.length, pairs, upserts };
}

export async function maintainSynapses() {
  const decay = await pool.query(
    `UPDATE neural_connections
     SET strength = GREATEST(0.0, strength * 0.98)
     WHERE last_activated < NOW() - INTERVAL '1 hour'`
  );
  const prune = await pool.query(
    `DELETE FROM neural_connections
     WHERE strength < 0.05`
  );
  return { decayed: decay.rowCount, pruned: prune.rowCount };
}

