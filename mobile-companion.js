import { execFileSync, spawn } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function clampLimit(value, fallback = 20, max = 80) {
  const n = Number.parseInt(value, 10);
  return Math.max(1, Math.min(max, Number.isFinite(n) ? n : fallback));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readJSONFile(path, fallback = null) {
  try {
    return path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : fallback;
  } catch {
    return fallback;
  }
}

function readJSONLFile(path, limit = 20) {
  try {
    if (!path || !existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

function redactText(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(account|acct|user|client)[_-]?(id|number)?[:= ]+[A-Za-z0-9_-]{8,}\b/gi, '$1_id=[redacted]');
}

function readTailLines(path, limit = 20) {
  try {
    if (!path || !existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map(redactText);
  } catch {
    return [];
  }
}

function fileTimestamp(path) {
  try {
    return path && existsSync(path) ? statSync(path).mtime.toISOString() : null;
  } catch {
    return null;
  }
}

function firstExistingDirectory(paths) {
  return paths.filter(Boolean).find((path) => {
    try { return existsSync(path) && statSync(path).isDirectory(); } catch { return false; }
  }) || null;
}

function resolveOneiroCoreDir() {
  return firstExistingDirectory([
    process.env.ONEIRO_CORE_DIR,
    resolve(MODULE_DIR, '..', 'runtime', 'workspace', 'oneiro-core'),
    resolve(MODULE_DIR, '..', '..', 'runtime', 'workspace', 'oneiro-core'),
    join(homedir(), 'oneiro', 'runtime', 'workspace', 'oneiro-core'),
    join(homedir(), 'Library', 'Application Support', 'Oneiro', 'runtime', 'workspace', 'oneiro-core')
  ]);
}

function resolveRobinhoodDir() {
  const coreDir = resolveOneiroCoreDir();
  return firstExistingDirectory([
    process.env.ONEIRO_ROBINHOOD_MIND_DIR,
    coreDir ? join(coreDir, 'minds', 'robinhood-mind') : null,
    join(homedir(), 'Library', 'Application Support', 'Oneiro', 'minds', 'robinhood-mind'),
    join(homedir(), 'oneiro', 'runtime', 'workspace', 'oneiro-core', 'minds', 'robinhood-mind')
  ]);
}

function processSnapshot(pattern) {
  try {
    const raw = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf-8' }).trim();
    const pids = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    if (pids.length === 0) return { running: false, pid: null };
    const psLines = execFileSync('ps', ['-p', pids.join(','), '-o', 'pid=,command='], { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) =>
        line &&
        !line.includes('/bin/zsh -c') &&
        !line.includes('/bin/sh -c') &&
        !line.includes('pgrep -f')
      );
    const preferred = psLines.find((line) => line.includes(pattern)) || psLines[0] || '';
    const pid = preferred.match(/^(\d+)/)?.[1] || pids[0] || null;
    return { running: Boolean(pid), pid: pid ? Number(pid) : null };
  } catch {
    return { running: false, pid: null };
  }
}

function mindDefinitions() {
  const coreDir = resolveOneiroCoreDir();
  const robinhoodDir = resolveRobinhoodDir();
  return {
    oca: {
      name: 'Oneiro OCA',
      pgrep: 'cognitive-loop.js',
      description: 'Primary cognitive loop and HTTP API'
    },
    thinker: {
      name: 'Thinker',
      pgrep: 'thinker',
      description: 'Inner monologue, reflection, and proactive thought telemetry'
    },
    trader: {
      name: 'Trader',
      label: 'com.oneiro.trader',
      command: 'node',
      args: coreDir ? [join(coreDir, 'minds', 'trader-mind.js')] : [],
      cwd: coreDir || undefined,
      pgrep: 'trader-mind.js',
      description: 'Autonomous crypto trading on Ethereum mainnet'
    },
    builder: {
      name: 'Builder',
      label: 'com.oneiro.builder',
      command: 'node',
      args: coreDir ? [join(coreDir, 'minds', 'builder-mind.js')] : [],
      cwd: coreDir || undefined,
      pgrep: 'builder-mind.js',
      description: 'Build task execution from dreams and plans'
    },
    auditor: {
      name: 'Auditor',
      label: 'com.oneiro.auditor',
      command: 'node',
      args: coreDir ? [join(coreDir, 'minds', 'auditor-mind.js')] : [],
      cwd: coreDir || undefined,
      pgrep: 'auditor-mind.js',
      description: 'Mind health checks, validation, and self-healing'
    },
    robinhood: {
      name: 'Robinhood Trader',
      label: 'com.oneiro.robinhood-trader',
      command: 'python3',
      args: robinhoodDir ? [join(robinhoodDir, 'main.py')] : [],
      cwd: robinhoodDir || undefined,
      pgrep: 'robinhood-mind/main.py',
      description: 'Stocks, options, and portfolio management through Robinhood'
    }
  };
}

function getMindStatus(id, definition, thinkerTelemetry) {
  let process = processSnapshot(definition.pgrep);
  if (id === 'oca') {
    process = { running: true, pid: Number(process.pid || globalThis.process?.pid || 0) || null };
  }
  if (id === 'thinker' && thinkerTelemetry?.lastRunAt) {
    const ageSeconds = Math.round((Date.now() - thinkerTelemetry.lastRunAt.getTime()) / 1000);
    process = { running: ageSeconds < 180, pid: null };
  }
  return {
    name: definition.name,
    description: definition.description,
    running: process.running,
    pid: process.pid,
    queue: null,
    state: id === 'thinker' ? {
      runs: thinkerTelemetry?.runs || 0,
      errors: thinkerTelemetry?.errors || 0,
      last_run_at: thinkerTelemetry?.lastRunAt || null,
      last_thought: thinkerTelemetry?.lastThought || null
    } : null,
    recentLog: []
  };
}

function getFullMindStatus(thinkerTelemetry) {
  const definitions = mindDefinitions();
  return {
    timestamp: new Date().toISOString(),
    minds: Object.fromEntries(
      Object.entries(definitions).map(([id, definition]) => [id, getMindStatus(id, definition, thinkerTelemetry)])
    ),
    pendingTasks: [],
    recentHistory: []
  };
}

function runLaunchctl(label, action) {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : '';
  if (!uid || !label) return false;
  try {
    if (action === 'start') {
      execFileSync('launchctl', ['kickstart', `gui/${uid}/${label}`], { stdio: 'ignore' });
    } else {
      execFileSync('launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

function startMind(id) {
  const definition = mindDefinitions()[id];
  if (!definition) return { error: `Unknown mind: ${id}` };
  const current = processSnapshot(definition.pgrep);
  if (current.running) return { status: 'already running', pid: current.pid };

  if (runLaunchctl(definition.label, 'start')) {
    return { status: 'started', pid: processSnapshot(definition.pgrep).pid };
  }

  const script = definition.args?.[0];
  if (definition.command && script && existsSync(script)) {
    try {
      const child = spawn(definition.command, definition.args, {
        cwd: definition.cwd,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return { status: 'started', pid: child.pid || null };
    } catch (e) {
      return { error: e.message };
    }
  }

  return { status: 'unavailable' };
}

function stopMind(id) {
  const definition = mindDefinitions()[id];
  if (!definition) return { error: `Unknown mind: ${id}` };
  runLaunchctl(definition.label, 'stop');
  try {
    execFileSync('pkill', ['-f', definition.pgrep], { stdio: 'ignore' });
  } catch {}
  return { status: 'stopped' };
}

function summarizePortfolio(portfolio = {}) {
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const totalEquity = safeNumber(portfolio.total_equity);
  const enrichedPositions = positions.map((position) => {
    const currentPrice = safeNumber(position.current_price);
    const quantity = safeNumber(position.quantity);
    const marketValue = currentPrice * quantity;
    return {
      ticker: position.ticker || 'UNKNOWN',
      quantity,
      avg_cost: safeNumber(position.avg_cost),
      current_price: currentPrice,
      pnl_pct: safeNumber(position.pnl_pct),
      market_value: marketValue,
      weight_pct: totalEquity > 0 ? (marketValue / totalEquity) * 100 : 0
    };
  });
  return {
    buying_power: safeNumber(portfolio.buying_power),
    total_equity: totalEquity,
    positions: enrichedPositions.sort((a, b) => b.market_value - a.market_value),
    option_positions: Array.isArray(portfolio.option_positions) ? portfolio.option_positions : [],
    crypto_positions: Array.isArray(portfolio.crypto_positions) ? portfolio.crypto_positions : [],
    timestamp: portfolio.timestamp || null,
    fetch_ok: portfolio.fetch_ok !== false
  };
}

function summarizeDecision(row = {}) {
  const action = row.action || row;
  const result = row.result || {};
  return {
    at: row.executed_at || row.decided_at || row.created_at || row.timestamp || null,
    type: action.type || row.type || null,
    ticker: action.ticker || row.ticker || null,
    reason: redactText(action.reason || row.reason || row.self_note || ''),
    confidence: safeNumber(action.confidence ?? row.confidence),
    edge_score: safeNumber(action.edge_score ?? row.edge_score),
    gate: action.decision_gate || row.decision_gate || null,
    result_state: result.derived_state || result.state || row.status || null,
    guardrail_dollar_value: safeNumber(row.guardrail_dollar_value ?? row.guardrail_adjusted_value),
    guardrail_adjusted_qty: safeNumber(row.guardrail_adjusted_qty),
    watchlist: Array.isArray(row.watchlist) ? row.watchlist : []
  };
}

function summarizeReflection(row = {}) {
  return {
    at: row.reflected_at || row.created_at || row.timestamp || null,
    summary: redactText(row.summary || row.lesson || row.content || ''),
    grade: row.grade || null,
    loss_amount_usd: safeNumber(row.loss_amount_usd),
    manual_user_loss_anchor: Boolean(row.manual_user_loss_anchor)
  };
}

function summarizePain(row = {}) {
  return {
    pain_id: row.pain_id || null,
    created_at: row.created_at || null,
    loss_amount_usd: safeNumber(row.loss_amount_usd),
    instrument: row.instrument || null,
    lesson: redactText(row.lesson || ''),
    intensity: safeNumber(row.intensity),
    setup_tags: Array.isArray(row.setup_tags) ? row.setup_tags : [],
    mistake_tags: Array.isArray(row.mistake_tags) ? row.mistake_tags : []
  };
}

function summarizeNews(item = {}) {
  return {
    headline: redactText(String(item.headline || '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')),
    description: redactText(item.description || ''),
    source: item.source || null,
    url: item.url || null,
    published: item.published || null,
    fetched_at: item.fetched_at || null
  };
}

function summarizeThesis(thesis = {}) {
  return {
    thesis_id: thesis.thesis_id || null,
    ticker: thesis.ticker || null,
    direction: thesis.direction || null,
    catalyst: redactText(thesis.catalyst || ''),
    timeframe: thesis.timeframe || '',
    confidence: safeNumber(thesis.confidence),
    status: thesis.status || null,
    target: thesis.target || '',
    stop_invalidation: thesis.stop_invalidation || '',
    updated_at: thesis.updated_at || null
  };
}

function buildRobinhoodSnapshot(limit = 20) {
  const robinhoodDir = resolveRobinhoodDir();
  const dataDir = robinhoodDir ? join(robinhoodDir, 'data') : null;
  const logsDir = robinhoodDir ? join(robinhoodDir, 'logs') : null;
  const portfolio = summarizePortfolio(readJSONFile(dataDir && join(dataDir, 'portfolio.json'), {}));
  const emotion = readJSONFile(dataDir && join(dataDir, 'emotion_state.json'), {});
  const auth = readJSONFile(dataDir && join(dataDir, 'auth_state.json'), {});
  const market = readJSONFile(dataDir && join(dataDir, 'market_context.json'), {});
  const theses = readJSONFile(dataDir && join(dataDir, 'active_theses.json'), []);

  const decisionsPath = logsDir && join(logsDir, 'decisions.jsonl');
  const cardsPath = logsDir && join(logsDir, 'decision-cards.jsonl');
  const reflectionsPath = logsDir && join(logsDir, 'reflections.jsonl');
  const tradesPath = logsDir && join(logsDir, 'trades.jsonl');
  const painPath = dataDir && join(dataDir, 'pain_events.jsonl');
  const logPath = logsDir && join(logsDir, 'main.log');

  return {
    generated_at: new Date().toISOString(),
    process: processSnapshot('robinhood-mind/main.py'),
    auth: {
      logged_in: Boolean(auth?.logged_in),
      timestamp: auth?.timestamp || null
    },
    emotion: {
      current_emotion: emotion?.current_emotion || 'unknown',
      confidence: safeNumber(emotion?.confidence),
      win_streak: safeNumber(emotion?.win_streak),
      loss_streak: safeNumber(emotion?.loss_streak),
      trades_today: safeNumber(emotion?.trades_today),
      pnl_today: safeNumber(emotion?.pnl_today),
      updated_at: emotion?.updated_at || null
    },
    portfolio,
    market: {
      updated_at: market?.updated_at || null,
      news: (Array.isArray(market?.news) ? market.news : []).slice(0, 12).map(summarizeNews)
    },
    active_theses: (Array.isArray(theses) ? theses : []).slice(-limit).reverse().map(summarizeThesis),
    recent_decisions: readJSONLFile(decisionsPath, limit).map(summarizeDecision),
    recent_decision_cards: readJSONLFile(cardsPath, limit).map(summarizeDecision),
    recent_reflections: readJSONLFile(reflectionsPath, limit).map(summarizeReflection),
    recent_trades: readJSONLFile(tradesPath, limit).map(summarizeDecision),
    pain_events: readJSONLFile(painPath, limit).map(summarizePain),
    recent_log: readTailLines(logPath, Math.min(limit, 40)),
    files: {
      portfolio: { updated_at: fileTimestamp(dataDir && join(dataDir, 'portfolio.json')) },
      market: { updated_at: fileTimestamp(dataDir && join(dataDir, 'market_context.json')) },
      decisions: { updated_at: fileTimestamp(decisionsPath) },
      decision_cards: { updated_at: fileTimestamp(cardsPath) },
      reflections: { updated_at: fileTimestamp(reflectionsPath) },
      trades: { updated_at: fileTimestamp(tradesPath) },
      pain: { updated_at: fileTimestamp(painPath) },
      log: { updated_at: fileTimestamp(logPath) }
    }
  };
}

async function queryRows(pool, sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch {
    return [];
  }
}

function buildPulseSnapshot(oca) {
  let live = {};
  let mood = {};
  try { live = oca?.layers?.emotion?.getState?.() || {}; } catch {}
  try { mood = oca?.layers?.emotion?.getMood?.() || {}; } catch {}
  const keys = ['curiosity', 'fear', 'frustration', 'satisfaction', 'excitement', 'attachment', 'creative_hunger'];
  const undercurrents = keys
    .map((key) => ({
      name: key.replace(/_/g, ' '),
      description: key.replace(/_/g, ' '),
      strength: safeNumber(mood[key] ?? live[key])
    }))
    .filter((item) => item.strength > 0)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5);
  return {
    mood: mood.label || mood.primary || live.current_mood || 'unknown',
    valence: safeNumber(mood.valence ?? live.valence),
    arousal: safeNumber(mood.arousal ?? live.arousal),
    energy_level: safeNumber(mood.energy_level ?? live.energy_level),
    undercurrents,
    oca: null
  };
}

async function buildSenseSnapshot(oca) {
  try {
    return await oca?.sense?.();
  } catch {
    return null;
  }
}

async function buildRecentSnapshot(pool, limit) {
  const [thoughtChains, reflections, dreams, notifications] = await Promise.all([
    queryRows(
      pool,
      `SELECT id, seed, depth, priority, status, created_at
         FROM thought_chains
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    ),
    queryRows(
      pool,
      `SELECT content, pattern_type, created_at
         FROM reflections
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    ),
    queryRows(
      pool,
      `SELECT id, content, type, weight, lifecycle_state, next_action, blocked_by, created_at
         FROM dreams
        WHERE resolved = false
        ORDER BY weight DESC, created_at DESC
        LIMIT $1`,
      [limit]
    ),
    queryRows(
      pool,
      `SELECT id, message, category, priority, read, metadata, created_at
         FROM notifications
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    )
  ]);
  return {
    thought_chains: thoughtChains,
    reflections,
    dreams,
    notifications
  };
}

function asMindList(status) {
  return Object.entries(status.minds || {}).map(([id, mind]) => ({
    id,
    name: mind?.name || id,
    description: mind?.description || '',
    running: Boolean(mind?.running),
    pid: mind?.pid || null,
    port: mind?.port || null,
    queue: mind?.queue || null,
    state: mind?.state || null,
    recent_log: Array.isArray(mind?.recentLog) ? mind.recentLog : []
  }));
}

export function registerMobileCompanionRoutes(router, { pool, oca, thinkerTelemetry }) {
  router.get('/minds/status', (_req, res) => {
    res.json(getFullMindStatus(thinkerTelemetry));
  });

  router.post('/minds/:id/start', (req, res) => {
    res.json(startMind(req.params.id));
  });

  router.post('/minds/:id/stop', (req, res) => {
    res.json(stopMind(req.params.id));
  });

  router.post('/minds/:id/restart', async (req, res) => {
    stopMind(req.params.id);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
    res.json(startMind(req.params.id));
  });

  router.get('/minds/robinhood/snapshot', (req, res) => {
    res.json(buildRobinhoodSnapshot(clampLimit(req.query.limit, 20, 80)));
  });

  router.get('/mobile/snapshot', async (req, res) => {
    const limit = clampLimit(req.query.limit, 20, 80);
    const mindStatus = getFullMindStatus(thinkerTelemetry);
    const [recent, sense] = await Promise.all([
      buildRecentSnapshot(pool, limit),
      buildSenseSnapshot(oca)
    ]);
    res.json({
      generated_at: new Date().toISOString(),
      pulse: buildPulseSnapshot(oca),
      minds: asMindList(mindStatus),
      pending_tasks: mindStatus.pendingTasks,
      recent_history: mindStatus.recentHistory,
      robinhood: buildRobinhoodSnapshot(limit),
      recent,
      context: { sense }
    });
  });
}

export default { registerMobileCompanionRoutes };
