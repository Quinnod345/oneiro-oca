# Failure-aware committing actions

The actuator checks persisted action history before asking for approval or evaluating a new commit. This is separate from task redispatch, sign-in need handling, and deployment continuation. It does not change the charter, spend limits, coursework restriction, or risk policy.

## Eligibility

An equivalent failed action is refused with its source action ID, target, and terminal failure reason. A new UUID, rewritten prompt, generic Continue, controller recreation, tab change, or transport recovery does not clear a capability failure. Read-only Aside tools remain available.

Identity uses the pursuit, action class, site, target/account, operation, and desired value. Common profile changes have deterministic matching; ambiguous intent requires a grounded semantic comparison. A different editing route is not a different target. Unavailable or malformed comparison leaves the retry closed. Explicitly different accounts, operations, and desired values remain eligible for the normal gates.

Unobserved actions are held until their outcome is verified and recorded through `/oca/act/observe`. A transport error reported as a failure still requires verification that the original commit did not take effect before a retry can be authorized. An older capability failure remains relevant even if a newer attempt failed on transport.

## Recovery evidence

Committing Aside tools accept an optional `retryEvidence` object, forwarded to `/oca/act/authorize`:

```json
{
  "retryEvidence": {
    "source": "https://example.com/account/settings",
    "quote": "An exact observed passage of at least 24 characters."
  }
}
```

The engine independently re-reads the source through Aside. The quote must exist in that result, and the returned page must belong to the action's site (`www` and `m` aliases count as the same site). A semantic check must establish that the observed state resolves every applicable failure for this target and proposed route. A generic support page, unrelated target, requested new approach, or restored browser connection is not evidence that a mobile-only editor now works. The check does not authorize phone access or introduce another browser.

One observed recovery permits at most one attempt. Page fingerprints and cited recovery-fact fingerprints persist on the authorized action, including after its outcome is recorded. Changing an evidence ID, selecting another quote from the same page, or changing unrelated page content cannot reuse the same recorded recovery. Changed recovery still goes through every normal authorization gate. If the source or semantic check is unavailable, discovery remains possible but the equivalent commit stays refused.

## Persistence and concurrency

No migration is required. New `agent_actions.observation` values use a versioned JSON envelope (`actionRetry: 1`) holding the terminal detail, recovery fingerprints, and source-backed recovery quotes with the failed action IDs. Legacy plain-text observations remain readable. `actionObservation`, `terminalObservation`, and `actionSummary` decode both formats; risk and strategist summaries retain the terminal reason, action ID, and target.

Browser, model, and policy checks run without holding a database connection. Immediately before a proceeding action is inserted, a short PostgreSQL advisory transaction lock protects a history revision check and durable claim. If history changed during authorization, that attempt is refused. This survives controller recreation and prevents concurrent requests from consuming the same recovery while avoiding connection-pool starvation.

## Verification

`tests/fixtures/instagram-retry-actions.json` contains the two stored Instagram failures. Tests replay them in isolated PostgreSQL schemas without executing browser commits. Regressions cover changed prompts and IDs, route aliases, controller recreation, unknown outcomes, transient recovery, older capability blockers, distinct intents, source/quote validation, single-use recovery, concurrent claims with one database connection, unchanged charter/risk checks, MCP non-execution, and planner failure context.

Run `node --test tests/`. In environments with an inherited outbound proxy, exclude `localhost`, `127.0.0.1`, and `::1` using `NO_PROXY` and `no_proxy` so local HTTP fixtures reach their test servers. Tests use injected semantic responses and browser reads; they do not establish live Instagram editing capability or a production merge.
