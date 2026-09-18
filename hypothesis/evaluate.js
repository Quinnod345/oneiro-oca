// Falsifiable observation checks. Prose similarity cannot establish truth.
const aliases = {
  front_app: ['front_app', 'frontApp', 'active_app', 'activeApp', 'app'],
  battery_pct: ['battery_pct', 'batteryPercent'], charging: ['charging', 'isCharging'],
  cpu_raw: ['cpu_raw', 'cpu', 'cpuLoad'], memory_pressure_pct: ['memory_pressure_pct', 'memoryPressurePct'],
  typing_wpm: ['typing_wpm', 'typingWpm', 'wpm'], idle_seconds: ['idle_seconds', 'idleSeconds'],
  hour: ['hour', 'currentHour'], thermal: ['thermal', 'thermal_pressure', 'thermalPressure'],
  presence: ['presence', 'userPresence'], app_switches_15min: ['app_switches_15min', 'appSwitches15min'],
};
const real = value => (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'
  || (typeof value === 'string' && !['', 'unknown', 'n/a', 'unavailable', 'null', 'undefined'].includes(value.trim().toLowerCase()));
const numeric = value => real(value) && typeof value !== 'boolean' && Number.isFinite(Number(value)) ? Number(value) : null;
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export function evaluateStructuredPrediction(expected, observed = {}) {
  const unknown = reason => ({ mode: 'structured', verifiable: false, verifiability: 'none',
    confirmed: null, score: null, surprise: null, reason });
  if (!expected || typeof expected.metric !== 'string' || !expected.metric.trim()) return unknown('missing_metric');
  const metric = expected.metric;
  const key = (aliases[metric] || [metric]).find(k => Object.hasOwn(observed || {}, k) && real(observed[k]));
  if (!key) return unknown(`metric_not_observed:${metric}`);
  const actual = observed[key], op = expected.operator || 'eq', value = expected.value;
  let confirmed;
  if (['gt', 'gte', 'lt', 'lte', 'between'].includes(op)) {
    const a = numeric(actual);
    if (a === null) return unknown(`metric_not_numeric:${metric}`);
    if (op === 'between') {
      const lo = numeric(expected.min ?? expected.lower), hi = numeric(expected.max ?? expected.upper);
      if (lo === null || hi === null || lo > hi) return unknown('invalid_expected_range');
      confirmed = a >= lo && a <= hi;
    } else {
      const b = numeric(value);
      if (b === null) return unknown('invalid_expected_number');
      confirmed = { gt: a > b, gte: a >= b, lt: a < b, lte: a <= b }[op];
    }
  } else if (op === 'in') {
    if (!Array.isArray(value) || !value.length || !value.every(real)) return unknown('invalid_expected_set');
    confirmed = value.some(v => same(actual, v));
  } else {
    if (!real(value)) return unknown('missing_expected_value');
    if (op === 'eq') confirmed = same(actual, value);
    else if (op === 'neq') confirmed = !same(actual, value);
    else if (op === 'contains' && typeof actual === 'string' && typeof value === 'string') confirmed = actual.toLowerCase().includes(value.toLowerCase());
    else return unknown(`unsupported_operator:${op}`);
  }
  return { mode: 'structured', verifiable: true, verifiability: 'structured', confirmed,
    score: confirmed ? 1 : 0, observedValue: actual,
    reason: `metric=${metric} observed=${JSON.stringify(actual)} operator=${op} expected=${JSON.stringify(value ?? [expected.min, expected.max])}` };
}
