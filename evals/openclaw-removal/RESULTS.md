# OpenClaw removal: before and after (2026-11-05)

**Before:** `main` at `9f5a9ab`, the engine on the OpenClaw gateway.
**After:** branch `engine/no-openclaw`.

Every number here comes from a script in this folder. Raw output is in `results/`.

| | Before | After |
|---|---|---|
| Engine suite (`node --test tests/`) | 356/356 pass (318 top-level tests) | **351/351 pass (334 top-level tests)** |
| Lines in engine code that reach OpenClaw at run time (CLI, `:18789`, `~/.openclaw`, gateway module) | 19 | **0** (`references.sh`; `tests/no-openclaw.test.mjs` keeps it at 0) |
| Mac app Swift files referencing OpenClaw / phone approvals / the gateway | 5 | **0** |
| Phone app (OpenClaw fork, 666 Swift files) in the repo | yes | **no**: archived in `~/Archive/oneiro-phone-app-2026-11-05` |
| OpenClaw on the machine (CLI, app, `~/.openclaw`, releases, npm package) | installed | **none**: moved to `~/Archive/openclaw-2026-11-05`, nothing deleted |
| A plain "yes" posted to a payment's ask approves the payment | **yes (a hole)** | **no**: refused (`payments-eval.mjs`) |
| Payment approval | OpenClaw push to the phone app | a one-time code texted back from Quinn's phone; hashed at rest, single use, 10 min |
| Where agents run | OpenClaw gateway sessions (a CLI process per call, 2 at a time) | Codex threads on the engine's own `codex app-server` (one long-lived process) |
| Where Quinn talks to the engine | the OpenClaw chat in the phone and Mac apps | T3 Code (each pursuit's conversation) and Codex (every agent's thread) |
| Coding agents reaching the engine | none | MCP server `oca`, registered in Codex and Claude Code |

**Why the suite's raw count fell while the tests grew:** the old gateway runtime tests replayed OpenClaw transcript fixtures as dozens of small subtests. They are replaced by the same guarantees tested against a scripted `codex app-server`:

- an in-flight turn never consumes progress;
- a turn finished while the engine was down is taken once;
- a cut-off turn continues in the same thread;
- an earlier turn's reply is never taken for the current run.

Changes by file:

| File | Top-level tests |
|---|---|
| `agent-host` | +8 |
| `mcp` | +6 |
| `no-openclaw` | +2 |
| agent runtime | +2 |
| iMessage keeper | +1 |
| `gateway` | −3 |

## The payment hole (`payments-eval.mjs`)

Same scenario against each checkout: an agent's payment asks; something posts "yes" to the ask; the agent retries with the approval.

- **Before:** `plainYesDecision: proceed`. Any process on the Mac could approve a payment with one `curl` to `/oca/inbox/asks/:id/answer`.
- **After:**
  - `plainYesDecision: refuse`.
  - Quinn's texted code approves (`codeFromPhoneApproves: true`), once (`codeReusable: false`).
  - The code is never stored (`codeStoredInPlaintext: false`).

## Live, end to end (`live-eval.mjs`): 16/16 in 53 s

Real Codex (signed in to ChatGPT, no metered key), the real T3 Code app, the engine's own runtime, and the MCP server over a real HTTP API.

1. A research agent deploys as a Codex thread in **0.39 s**, reads a file, and finishes with its evidence **verified by the engine**.
2. The thread is in Codex's own index:
   - originator `oca-engine`;
   - source `vscode`, so it is listed for `codex resume`;
   - named `#1 research · …`.
3. An agent that needs Quinn stops and asks. The pursuit's conversation opens as a **T3 Code thread on Codex**, and the agent's question is posted there. The same thread also shows in Codex (originator `T3 Code`).
4. An answer written in that T3 Code thread ("Use the Canada store.") reaches the waiting agent as Quinn's words. The agent finishes: "Quinn chose the Canada App Store region."
5. The MCP server:
   - lists the agents;
   - reads a work agent's thread (open with `codex resume <id>`);
   - gives the T3 Code link for the conversation;
   - inside the engine's T3 project, offers only the tools that read.

The live eval leaves its threads behind, each titled `[eval] …` / `#1 …`, in Codex and in T3 Code's "Oneiro engine" project.

## The iMessage line (`imessage-readonly-eval.mjs`)

Read-only and live:

- Messages on the work Mac answers over SSH.
- Quinn's conversation is found (chat 930).
- His recent replies are readable.

No text was sent. `scripts/test-payment-approval.mjs` texts him a test code when he wants to check the round trip.

## Not run "before"

The OpenClaw gateway was already switched off (`com.oneiro.oca` disabled; nothing answering on `:18789`) when this work began, so the old agent path could not be timed live. Its cost is in its code: every gateway call spawned a whole `openclaw` CLI process (seconds of CPU), throttled to two at a time.
