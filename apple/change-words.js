// What an Apple change would do, in plain words, and how an open ask names the Terminal step that approves it.
// The broker's privilege separation is the point: only Quinn, in Terminal, can approve one of these. The app shows the
// words and the command, and nothing here can approve anything. Pure, so both the loop and the inbox can use it.
const line = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** One plain sentence on what a proposal would change, from what the proposal itself holds. */
export function appleChangeWords({ kind, why = '', request = null, evidence = null } = {}) {
  const item = request?.body?.items?.[0]?.data || {};
  switch (kind) {
    case 'review_reply': {
      const reply = line(request?.body?.data?.attributes?.responseBody, 400);
      const rating = Number(evidence?.rating);
      const about = Number.isFinite(rating) && rating > 0 ? `a ${rating}-star App Store review` : 'an App Store review';
      return reply ? `Posts this public reply to ${about}: “${reply}”` : `Posts a public reply to ${about}.`;
    }
    case 'promote_keyword': return `Adds “${line(item.text, 80)}” as an Apple Ads keyword, bidding ${line(item.bid?.amount, 12)} ${line(item.bid?.currency, 6)}.`;
    case 'negative_keyword': return `Stops Apple Ads from showing for “${line(item.text, 80)}”.`;
    case 'bid_up':
    case 'bid_down': return `${kind === 'bid_up' ? 'Raises' : 'Lowers'} an Apple Ads bid to ${line(item.bid?.amount, 12)} ${line(item.bid?.currency, 6)}. ${line(why, 200)}`.trim();
    default: return line(why, 400) || 'Changes something in your Apple account.';
  }
}

const ASK = /Approve an Apple change: (.*?)\.? In Terminal on your Mac, run: (\S.*?)(?:\s+—\s.*)?$/s;
/** Reads an ask written before the engine recorded its Apple change separately. Null for anything else. */
export function parseAppleAsk(message) {
  const m = ASK.exec(String(message ?? '').replace(/\.\s*$/, ''));
  if (!m) return null;
  const command = line(m[2], 400);
  const approval = /\bapprove\s+([0-9a-f]{6,})\b/.exec(command)?.[1] || null;
  return { why: line(m[1], 300), command, approval };
}
