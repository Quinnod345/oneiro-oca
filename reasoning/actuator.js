// The actuator: the one place an agent's action on the world is decided. Every committing step — signing in,
// publishing, submitting a form, uploading, spending, messaging, deleting — comes here first, from the Aside
// tools or any other hand the engine grows. The person's charter (user-controls) is what they fired in
// advance: a granted class proceeds after `ramp` one-tap approvals of that class; an ungranted class, any payment
// at all, or any committing step on Apple's or Meta's consoles asks for that one action. Ad budgets count as what
// they commit through the month. The risk gate still appraises and journals every attempt and
// still refuses what a constraint forbids. What happened is observed afterwards, from the page, not the plan.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import { createActionRetries, actionObservation, terminalObservation, actionHost } from './action-retries.js';
import { CHARTER_CLASSES } from '../user-controls.js';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const APP_ACCOUNT_PREREQUISITE = /\b(?:application_id|app store id)\b/i;
const APP_NOT_CONNECTED = /\bnot connected to (?:your|the|this) (?:ad )?account\b/i;

// A provider prerequisite is still a failed action and must remain in agent_actions so retries stay
// suppressed. It is not evidence that act_reversible itself failed, though: keep it out of the
// capability track record so external validation wording cannot manufacture a self-build defect.
function riskOutcome(result, observation) {
  const detail = terminalObservation(observation, 1500);
  const externalPrerequisite = result === 'failure' && /^BLOCKED:/i.test(detail)
    && APP_ACCOUNT_PREREQUISITE.test(detail) && APP_NOT_CONNECTED.test(detail);
  return externalPrerequisite
    ? { result: 'not_attempted', note: 'External app/account prerequisite blocked completion; action history retains the failure for retry suppression.' }
    : { result, note: '' };
}
export const YES = /^\s*(y|yes|yep|yeah|ok|okay|approve[d]?|allow(ed)?|do it|go( ahead)?|sure|post it|send it|ship it|👍|✅)\b/i;
export const NO = /^\s*(n|no|nope|don'?t|do not|stop|deny|denied|decline[d]?|cancel|❌|👎)\b/i;

// Graded coursework is Quinn's to do: nothing is submitted, posted or uploaded on a course or assessment
// site in his name. Reading those sites (to study, to plan) stays open.
export const COURSEWORK_HOSTS = /(^|\.)(instructure\.com|canvas\.[a-z.]+|pearson\.com|pearsoned\.com|mylabmastering\.com|mathxl\.com|mheducation\.com|webassign\.net|gradescope\.com|blackboard\.com|brightspace\.com|d2l\.com|moodle\.[a-z.]+|yellowdig\.app|yellowdig\.com|turnitin\.com|proctorio\.com|respondus\.com|cengage\.com|wiley\.com|wileyplus\.com|quizlet\.com|chegg\.com|psu\.edu)$/i;
export function isCoursework(host) { return COURSEWORK_HOSTS.test(String(host || '').toLowerCase().replace(/:\d+$/, '')); }

// Where money or a public store listing is one click away, what a control commits can't be read off its name:
// a "Save" on a budget page spends, and a "Submit" on App Store Connect publishes to the store. So on Apple's
// and Meta's consoles every committing class asks Quinn, whatever the charter grants. On other ad consoles
// everything except an explicitly costed spend asks; that spend is still bounded by the monthly cap. The list
// lives in code, not in the charter, so no settings change can quietly shorten it.
export function guardedConsole(host, url = '') {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  let path = ''; try { path = new URL(url).pathname.toLowerCase(); } catch {}
  if (/(^|\.)(appstoreconnect|developer|ads|app-ads|searchads)\.apple\.com$/.test(h)) return { owner: 'Apple', always: true };
  if (/(^|\.)(business|adsmanager)\.facebook\.com$/.test(h) || (/(^|\.)facebook\.com$/.test(h) && /^\/(adsmanager|ads\/)/.test(path))) return { owner: 'Meta', always: true };
  if (/^ads\.[a-z0-9-]+\.[a-z.]+$/.test(h)) return { owner: 'an ad network', always: false };
  return null;
}

// An ad budget is a standing commitment, not a one-off cost: a daily budget keeps spending every day until it
// changes. It counts as what it commits through the end of the month (its increase over the budget it
// replaces, times the days left, today included), so one monthly cap bounds recurring and one-off spend alike.
export function budgetCommitment({ dailyBudget, previousDailyBudget = 0, now = Date.now() }) {
  const d = new Date(now);
  const daysLeft = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
  const increase = Math.max(0, (Number(dailyBudget) || 0) - (Number(previousDailyBudget) || 0));
  return { daysLeft, increase, committed: Math.round(increase * daysLeft * 100) / 100 };
}

// externalSpend: spend this month that the engine does not record as actions but that counts against the same
// cap, such as the Apple broker's committed Ads budgets. If it can't be read, the cap can't be checked.
export function createActuator({ pool, risk = null, asks = null, controls, queue = null, clock = Date.now, log = console, llm = null, aside = null, externalSpend = null } = {}) {
  const retries = createActionRetries({ llm, aside, log });
  async function init() { await pool.query(await readFile(new URL('../migrations/063_agent_actions.sql', import.meta.url), 'utf8')); }
  const monthStart = () => { const d = new Date(clock()); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
  async function spendThisMonth() {
    const { rows: [r] } = await pool.query(`SELECT COALESCE(sum(cost), 0)::float AS n FROM agent_actions WHERE class = 'spend' AND decision = 'proceed'
      AND COALESCE(outcome, 'success') <> 'failure' AND created_at >= to_timestamp($1 / 1000.0)`, [monthStart()]);
    if (!externalSpend) return { total: r.n, unknown: false };
    try { return { total: r.n + (Number(await externalSpend()) || 0), unknown: false }; }
    catch (e) { log.warn?.('[actuator] external spend unavailable:', text(e.message, 160)); return { total: r.n, unknown: true }; }
  }
  async function monthSpend() { return (await spendThisMonth()).total; }
  async function rampDone(cls) {
    const { rows: [r] } = await pool.query(`SELECT count(*)::int AS n FROM agent_actions WHERE class = $1 AND decision = 'proceed' AND outcome = 'success'`, [cls]);
    return r.n;
  }
  // The notification for a payment. The phone shows about 250 characters, so the cost and the question go last and
  // always survive; the description gives way.
  function paymentPrompt({ description, host, spendCost, dailyBudget, costWords }) {
    const on = host ? ` on ${host}` : '';
    const title = dailyBudget ? `Approve a $${Number(dailyBudget).toFixed(2)}/day budget${on}?` : spendCost > 0 ? `Approve $${spendCost.toFixed(2)}${on}?` : `Approve a payment${on}?`;
    const tail = ` (${costWords}). Are you sure you want to go through with this?`;
    const lead = `Oneiro wants to ${text(description, 400)}${on}`, room = Math.max(60, 250 - tail.length);
    return { title: text(title, 80), description: (lead.length > room ? `${lead.slice(0, room - 1).trimEnd()}…` : lead) + tail };
  }
  // The person's answer to an approval ask, read from the ask itself.
  async function approvalOf(askId) {
    const { rows: [a] } = await pool.query(`SELECT id, reply, replied_at, metadata FROM notifications WHERE id = $1 AND category = 'ask'`, [askId]);
    if (!a) return { state: 'unknown' };
    if (!a.replied_at) return { state: 'pending', ask: a };
    if (YES.test(a.reply || '')) return { state: 'yes', ask: a };
    if (NO.test(a.reply || '')) return { state: 'no', ask: a };
    return { state: 'unclear', ask: a };
  }

  async function authorize({ chainId, class: cls, host = '', url = '', control = '', description, cost = 0, dailyBudget = null, previousDailyBudget = 0, approval = null, sessionKey = null, agent = null, retryEvidence = null } = {}) {
    if (!CHARTER_CLASSES.includes(cls)) throw new Error(`an action class is one of ${CHARTER_CLASSES.join(', ')}`);
    if (typeof description !== 'string' || description.trim().length < 5) throw new Error('say what the action is');
    const id = randomUUID();
    // A daily budget is charged as what it commits through the month's end; a stated cost can only add to that.
    const commitment = cls === 'spend' && Number(dailyBudget) > 0 ? budgetCommitment({ dailyBudget, previousDailyBudget, now: clock() }) : null;
    const spendCost = Math.max(Number(cost) || 0, commitment?.committed || 0);
    const costWords = commitment
      ? `a daily budget of $${Number(dailyBudget).toFixed(2)}${Number(previousDailyBudget) > 0 ? ` (was $${Number(previousDailyBudget).toFixed(2)})` : ''}, $${commitment.committed.toFixed(2)} committed through the end of the month`
      : spendCost > 0 ? `cost $${spendCost.toFixed(2)}` : 'the cost wasn\'t stated';
    const want = queue ? await queue.get(Number(chainId)) : { want: { status: 'active' } };
    const candidate = { chainId: Number(chainId) || 0, class: cls, host, url, control, description };
    let retry = { eligible: true };
    const record = async (decision, why, extra = {}) => {
      // Browser/model/policy work happens without a pinned connection. Only the final history
      // check and claim are locked, so concurrent controllers cannot duplicate a recovered attempt
      // or exhaust the pool while waiting on each other's evidence checks.
      if (decision === 'proceed' && retry.recovery) why += `; one recovery attempt after ${retry.recoveryEvidence[0].failedActionId}`;
      const db = decision === 'proceed' ? await pool.connect() : pool;
      try {
        if (decision === 'proceed') {
          await db.query('BEGIN');
          await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`action:${candidate.chainId}:${cls}:${actionHost(host)}`]);
          if (!await retries.unchanged(db, candidate, retry.snapshot)) {
            decision = 'refuse';
            why = 'Retry suppressed: action history changed during authorization. Read the latest action outcome before trying again.';
          }
        }
        await db.query(`INSERT INTO agent_actions (id, chain_id, class, host, url, control, description, cost, decision, why, ask_id, approved_by_ask, created_at, observation)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, to_timestamp($13 / 1000.0), $14)`,
        [id, Number(chainId) || 0, cls, text(host, 200), text(url, 1000), text(control, 200), text(description, 2000), spendCost, decision, text(why, 500), extra.askId || null, extra.approvedBy || null, clock(), JSON.stringify({ actionRetry: 1, detail: '', recovery: decision === 'proceed' ? retry.recovery || null : null, recoveryFacts: decision === 'proceed' ? retry.recoveryFacts || [] : [], recoveryEvidence: decision === 'proceed' ? retry.recoveryEvidence || [] : [] })]);
        if (db !== pool) await db.query('COMMIT');
      } catch (e) { if (db !== pool) await db.query('ROLLBACK'); throw e; }
      finally { if (db !== pool) db.release(); }
      log.log?.(`[actuator] ${cls} on ${host || '—'} for #${chainId}: ${decision}${extra.askId ? ` (ask #${extra.askId})` : ''} — ${text(why, 140)}`);
      return { decision, actionId: id, why, ...extra };
    };
    if (!want || want.want?.status !== 'active') return record('refuse', 'no active pursuit is named; an action serves a pursuit');
    if (cls !== 'sign_in' && isCoursework(host)) return record('refuse', `${host} is a course or assessment site: graded work is submitted by Quinn himself, never by the engine`);
    retry = await retries.check(pool, candidate, retryEvidence);
    if (!retry.eligible) return record('refuse', retry.why);
    const charter = (await controls.get()).charter || {};
    const grant = charter[cls] || { granted: false };
    let approvedBy = null;
    if (approval) {
      const a = await approvalOf(Number(approval));
      if (a.state === 'yes' && Number(a.ask?.metadata?.chainId) === Number(chainId)) approvedBy = a.ask.id;
      else if (a.state === 'no') return record('refuse', `Quinn declined (ask #${a.ask.id}: "${text(a.ask.reply, 80)}")`);
      else if (a.state === 'pending') return record('ask', `waiting for Quinn's answer to ask #${approval}`, { askId: Number(approval), question: a.ask?.metadata?.detail || '' });
    }
    // Does this action need the person's yes?
    let needs = null;
    if (!approvedBy) {
      const guarded = cls === 'sign_in' ? null : guardedConsole(host, url);
      if (guarded && (guarded.always || cls !== 'spend')) {
        needs = guarded.always
          ? `${host} is ${guarded.owner}'s console, where a click can publish or spend: every ${cls} there needs Quinn's yes, whatever the charter grants`
          : `${host} is an ad console, where a ${cls} can change spend without stating it: it needs Quinn's yes (a costed spend goes through the monthly cap)`;
      } else if (!grant.granted) needs = `the charter does not grant ${cls}`;
      else if (cls === 'spend') {
        // Every payment waits for Quinn's yes, whatever the charter grants (Quinn, 2026-09-29). The monthly cap no
        // longer lets anything through on its own; it only frames the question. Lowering a budget commits nothing new.
        const lowersOnly = commitment && commitment.increase === 0 && !(Number(cost) > 0);
        if (!lowersOnly) {
          const { total: spent, unknown } = await spendThisMonth(), cap = Number(grant.monthlyCap) || 0;
          if (!(spendCost > 0)) needs = 'a spend must state its cost';
          else if (unknown) needs = 'this month\'s spend outside the engine could not be read, so the cap cannot be checked';
          else if (spent + spendCost > cap) needs = `$${spendCost.toFixed(2)} would take this month's spend to $${(spent + spendCost).toFixed(2)}, past the $${cap} cap`;
          else needs = `every payment waits for Quinn's yes ($${spent.toFixed(2)} spent this month)`;
        }
      }
      if (!needs && (charter.ramp || 0) > 0 && (await rampDone(cls)) < charter.ramp) needs = `the first ${charter.ramp === 1 ? '' : `${charter.ramp} `}${cls} action${charter.ramp === 1 ? '' : 's'} need${charter.ramp === 1 ? 's' : ''} one yes from Quinn`;
    }
    if (needs) {
      const question = cls === 'spend'
        ? `Oneiro wants to ${text(description, 280)}${host ? ` on ${host}` : ''} (${costWords}). Are you sure you want to go through with this? Reply yes or no.`
        : `Oneiro wants to ${text(description, 280)}${host ? ` on ${host}` : ''}. OK? Reply yes or no.`;
      let askId = null;
      if (asks) {
        // A payment asks on the phone with Approve and Deny; everything else asks as before.
        const payment = cls === 'spend' ? { ...paymentPrompt({ description, host, spendCost, dailyBudget: commitment ? dailyBudget : null, costWords }),
          detail: `${question}\nWhy it asks: ${needs}` } : null;
        const r = await asks.ask({ chainId: Number(chainId), kind: 'question', detail: question, want: want.want?.description || '', stakes: want.want?.stakes || [], sessionKey, agent, payment }).catch(e => ({ error: e.message }));
        askId = r?.id ?? null;
      }
      return record('ask', needs, { askId, question });
    }
    // The risk gate appraises and journals it. A one-time yes is the person firing this one action.
    const c = (await controls.get());
    const charterForThis = approvedBy ? { ...(c.charter || {}), [cls]: { ...(c.charter?.[cls] || {}), granted: true } } : c.charter;
    let d = { decision: 'proceed', reasons: [] };
    if (risk) {
      d = await risk.decide({ id: `act:${id}`, chainId: Number(chainId) || null, kind: 'app_action', firedBy: approvedBy ? 'person' : 'engine',
        description: `${cls}: ${text(description, 1500)}${host ? ` on ${host}` : ''}`, serves: want.want?.stakes || [], touches: [],
        reversibility: cls === 'spend' || cls === 'message' || cls === 'destroy' ? 'none' : 'undo', standing: cls },
        { controls: { autonomousActions: c.autonomousActions === true, charter: charterForThis } });
    }
    if (d.decision !== 'proceed') return record('refuse', (d.reasons || [d.why || d.decision]).join(' '), { approvedBy });
    return record('proceed', approvedBy ? `approved by Quinn (ask #${approvedBy})` : `under the charter (${cls})`, { approvedBy });
  }

  async function observe({ actionId, result, observation = '' }) {
    if (!['success', 'failure'].includes(result)) throw new Error('an outcome is success or failure');
    const { rows: [prior] } = await pool.query('SELECT observation FROM agent_actions WHERE id = $1', [actionId]);
    const saved = { ...actionObservation(prior?.observation), actionRetry: 1, detail: terminalObservation(observation, 1500) };
    const { rows: [a] } = await pool.query(`UPDATE agent_actions SET outcome = $2, observation = $3, observed_at = to_timestamp($4 / 1000.0) WHERE id = $1 AND decision = 'proceed' AND outcome IS NULL RETURNING *`,
      [actionId, result, JSON.stringify(saved), clock()]);
    if (!a) throw new Error('no proceeding action by that id awaits an outcome');
    const tracked = riskOutcome(result, observation);
    if (risk) await risk.observe(`act:${actionId}`, { ...tracked, evidence: [{ id: `act-${String(actionId).slice(0, 8)}`, source: `actuator action ${actionId}: ${a.url || a.host}`, observation: `${a.class} on ${a.host}: ${terminalObservation(observation, 800) || result}` }] }).catch(e => log.warn?.('[actuator] observe:', e.message));
    log.log?.(`[actuator] ${a.class} on ${a.host} for #${a.chain_id}: ${result}`);
    return { actionId, result };
  }
  async function recent({ limit = 50 } = {}) {
    const { rows } = await pool.query(`SELECT id, chain_id, class, host, url, control, description, cost, decision, why, ask_id, approved_by_ask, outcome, observation, created_at FROM agent_actions ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows;
  }

  const router = Router();
  const route = h => async (req, res) => { try { res.json(await h(req)); } catch (e) { res.status(400).json({ error: e.message }); } };
  router.post('/oca/act/authorize', route(req => authorize(req.body || {})));
  router.post('/oca/act/observe', route(req => observe(req.body || {})));
  router.get('/oca/act', route(async () => ({ charter: (await controls.get()).charter, monthSpend: await monthSpend(), actions: await recent() })));
  return { init, authorize, observe, recent, monthSpend, router };
}
