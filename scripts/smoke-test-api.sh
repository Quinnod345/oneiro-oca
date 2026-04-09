#!/usr/bin/env bash
# Smoke-test all HTTP endpoints on localhost:3333. Safe: no motor execution, no heavy LLM chats.
set -euo pipefail
BASE="http://localhost:3333"
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[0;33m'; RST='\033[0m'

pass=0; fail=0; skip=0
line() { local name="$1" code="$2" note="${3:-}"
  if [[ "$code" =~ ^(2|3)[0-9][0-9]$ ]]; then echo -e "${GRN}OK${RST} $code  $name"; ((pass++)) || true
  elif [[ "$code" == "SKIP" ]]; then echo -e "${YEL}SKIP${RST}     $name — $note"; ((skip++)) || true
  else echo -e "${RED}FAIL${RST} $code  $name"; ((fail++)) || true
  fi
}

# Expected client error (validation) — proves handler is mounted
line_4xx() {
  local name="$1" code="$2"
  if [[ "$code" == "400" || "$code" == "404" || "$code" == "409" || "$code" == "422" ]]; then
    echo -e "${GRN}OK${RST} $code  $name (expected validation/not-found)"
    ((pass++)) || true
  else
    line "$name" "$code"
  fi
}

# Missing DB row: prefer 404; older OCA may still return 500 with "not found" in JSON
line_missing_row() {
  local name="$1" code="$2"
  local body
  body=$(cat /tmp/_oca_api_body.json 2>/dev/null || echo "")
  if [[ "$code" == "404" ]] || [[ "$code" == "500" && "$body" == *"not found"* ]]; then
    echo -e "${GRN}OK${RST} $code  $name (missing row)"
    ((pass++)) || true
  else
    line "$name" "$code"
  fi
}

get() {
  local name="$1" path="$2" expect="${3:-}"
  code=$(curl -sS -m 90 -o /tmp/_oca_api_body.json -w "%{http_code}" "$BASE$path" || echo "000")
  if [[ -n "$expect" ]] && [[ "$code" == "$expect" ]]; then line "$name" "$code"; return; fi
  line "$name" "$code"
}

post_json() {
  local name="$1" path="$2" json="$3" maxt="${4:-120}"
  code=$(curl -sS -m "$maxt" -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE$path" \
    -H 'Content-Type: application/json' -d "$json" || echo "000")
  line "$name" "$code"
}

echo "=== OCA API smoke test → $BASE ==="
echo

code=$(curl -sS -m 10 -o /dev/null -w "%{http_code}" -X OPTIONS "$BASE/pulse" || echo 000)
line "OPTIONS /pulse (CORS preflight)" "$code"
get "GET /web/index.html (static)" "/web/index.html"

echo "--- Core psyche / OpenClaw API ---"
get "GET /pulse" "/pulse"
post_json "POST /recall" "/recall" '{"query":"health","limit":2}'
post_json "POST /feel" "/feel" '{"content":"api smoke","feeling":"neutral","intensity":0.2}'
post_json "POST /ponder (queued only)" "/ponder" '{"seed":"smoke test queue","priority":0.1,"immediate":false}'
post_json "POST /drift" "/drift" '{"name":"activation","strength":0.3,"description":"smoke"}'
post_json "POST /bond" "/bond" '{"subject":"smoke-test","feeling":"ok","trust":0.5,"familiarity":0.5}'
post_json "POST /dream" "/dream" '{"content":"smoke dream line","type":"wonder","weight":0.1}'
get "GET /dreams" "/dreams"
get "GET /self" "/self"
get "GET /outbox" "/outbox"
get "GET /context" "/context"
sc_shot=$(curl -sS -m 15 -o /dev/null -w "%{http_code}" "$BASE/screenshot/latest" || echo 000)
if [[ "$sc_shot" == "200" ]] || [[ "$sc_shot" == "404" ]]; then line "GET /screenshot/latest" "$sc_shot"; else line "GET /screenshot/latest" "$sc_shot"; fi

get "GET /autonomy" "/autonomy"
post_json "POST /autonomy/check" "/autonomy/check" '{"stimulus":"read_only"}'
get "GET /notifications" "/notifications?limit=5"
get "GET /recall/conversations" "/recall/conversations?q=smoke&limit=3"
post_json "POST /index-turn" "/index-turn" '{"source":"smoke","channel":"test","content":"api smoke index","intensity":0.2}'
get "GET /minds" "/minds"
get "GET /trader" "/trader"
get "GET /conversations" "/conversations?limit=3"
get "GET /conversations/:id (smoke id)" "/conversations/smoke-test-no-msgs"

# POST /private/index — full private/ re-index; can exceed 3+ minutes. Smoke-test separately if needed.
line "POST /private/index (long-running indexer)" "SKIP" "not in default suite — run manually with long curl -m"

post_json "POST /notify" "/notify" '{"message":"smoke test notification","category":"thought","priority":"low","metadata":{"source":"smoke"}}'
post_json "POST /nudge" "/nudge" '{"text":"smoke nudge","intensity":0.3}'

# PATCH dreams — first dream id if any
DREAM_ID=$(curl -sS -m 30 "$BASE/dreams?limit=1" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.dreams&&j.dreams[0]?j.dreams[0].id:'')}catch{console.log('')}})" 2>/dev/null || echo "")
if [[ -n "$DREAM_ID" ]]; then
  code=$(curl -sS -m 30 -o /tmp/_oca_api_body.json -w "%{http_code}" -X PATCH "$BASE/dreams/$DREAM_ID/action" \
    -H 'Content-Type: application/json' -d '{"next_action":"can_run_now"}' || echo 000)
  line "PATCH /dreams/$DREAM_ID/action" "$code"
else
  line "PATCH /dreams/:id/action" "SKIP" "no dreams in DB"
fi

echo
echo "--- Outbox router ---"
get "GET /outbox/ready" "/outbox/ready"
get "GET /outbox/all" "/outbox/all"

echo
echo "--- Sub-mind ---"
get "GET /minds/status" "/minds/status"

echo
echo "--- OCA /oca/* (GET) ---"
get "GET /oca/status" "/oca/status"
get "GET /oca/neural" "/oca/neural?limit=20"
get "GET /oca/vision" "/oca/vision"
get "GET /oca/visual-memory" "/oca/visual-memory?query=test&limit=3"
get "GET /oca/visual-memory/timeline" "/oca/visual-memory/timeline?limit=10"
get "GET /oca/visual-memory/recent" "/oca/visual-memory/recent?limit=5"
get "GET /oca/sense" "/oca/sense"
get "GET /oca/emotion" "/oca/emotion"
get "GET /oca/emotion/rolling" "/oca/emotion/rolling?minutes=60"
get "GET /oca/hippo-stats" "/oca/hippo-stats"
get "GET /oca/entities" "/oca/entities?query=a&limit=5"
get "GET /oca/entities/relations" "/oca/entities/relations?entityKey=test&limit=5"
get "GET /oca/hypotheses" "/oca/hypotheses"
get "GET /oca/predictions/diagnostics" "/oca/predictions/diagnostics?days=7"
get "GET /oca/predictions/failures" "/oca/predictions/failures?days=7&limit=10"
get "GET /oca/predictions/sla" "/oca/predictions/sla?minutes=25"
get "GET /oca/predictions/graveyard" "/oca/predictions/graveyard?days=30&limit=10"
get "GET /oca/reflect" "/oca/reflect"
get "GET /oca/goals" "/oca/goals"
get "GET /oca/autonomic/metrics" "/oca/autonomic/metrics"
get "GET /oca/autonomic/trends" "/oca/autonomic/trends"
get "GET /oca/autonomic/history" "/oca/autonomic/history?limit=5"
get "GET /oca/workspace" "/oca/workspace"
get "GET /oca/body" "/oca/body"
get "GET /oca/intentions" "/oca/intentions"
get "GET /oca/crm" "/oca/crm"
get "GET /oca/benchmark/history" "/oca/benchmark/history?days=7&limit=20"
get "GET /oca/anti-decay" "/oca/anti-decay"
get "GET /oca/anti-decay/history" "/oca/anti-decay/history?horizon=medium&days=14"
get "GET /oca/operating-time" "/oca/operating-time"
get "GET /oca/neural-bus/full" "/oca/neural-bus/full"
get "GET /oca/neural-bus/heatmap" "/oca/neural-bus/heatmap"
get "GET /oca/neural-bus" "/oca/neural-bus"
get "GET /oca/identity" "/oca/identity"
get "GET /oca/identity/history" "/oca/identity/history?limit=10"
get "GET /oca/body-inventory" "/oca/body-inventory"
get "GET /oca/conventions" "/oca/conventions"
get "GET /oca/conventions/drift" "/oca/conventions/drift"
get "GET /oca/consent-review" "/oca/consent-review"
get "GET /oca/llm-status" "/oca/llm-status"

echo
echo "--- OCA /oca/* (POST, safe / validation-only) ---"
post_json "POST /oca/experience" "/oca/experience" '{"eventType":"system","content":"smoke test ping","importanceScore":0.01}'
post_json "POST /oca/remember" "/oca/remember" '{"query":"test","limit":2}'
post_json "POST /oca/know" "/oca/know" '{"query":"test","limit":2}'
post_json "POST /oca/learn" "/oca/learn" '{"concept":"smoke-test concept (safe)","confidence":0.1,"sourceType":"test"}'
# contradict: skip without real conceptId — expect 400
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/contradict" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/contradict (no conceptId)" "$code"

post_json "POST /oca/hippo-recall" "/oca/hippo-recall" '{"query":"oneiro cognitive","limit":3}'
post_json "POST /oca/predict" "/oca/predict" '{"domain":"smoke","claim":"x","prediction":"y","confidence":0.3}'
code=$(curl -sS -m 60 -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/test" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/test (missing ids)" "$code"
post_json "POST /oca/decide" "/oca/decide" '{"decision":"smoke: allow test","stakes":"low","context":"automated smoke","timeBudgetSeconds":5}'
post_json "POST /oca/reason" "/oca/reason" '{"goal":"smoke sanity check","context":"api test","stakes":"low","timeBudgetSeconds":8}'
code=$(curl -sS -m 60 -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/reason/evaluate" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/reason/evaluate (bad body)" "$code"
post_json "POST /oca/imagine" "/oca/imagine" '{"description":"hypothetical smoke scenario","state":{},"actions":[],"purpose":"test"}'
code=$(curl -sS -m 60 -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/simulate/evaluate" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/simulate/evaluate (missing ids)" "$code"
code=$(curl -sS -m 60 -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/counterfactual/evaluate" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/counterfactual/evaluate (missing ids)" "$code"
post_json "POST /oca/causal/experiment" "/oca/causal/experiment" '{"causeDescription":"smoke cause","intervention":"observe only","confidence":0.2,"start":false}'
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/causal/experiment/999999999/complete" -H 'Content-Type: application/json' -d '{"actualOutcome":"n/a"}' || echo 000)
line "POST /oca/causal/experiment/:id/complete (bad id)" "$code"

post_json "POST /oca/create" "/oca/create" '{"method":"connection"}'
post_json "POST /oca/goals" "/oca/goals" '{"description":"smoke goal (delete later)","goalType":"session","priority":0.01}'

# Motor: missing fields → 400 (no execution)
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/motor/type" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/motor/type (no text)" "$code"
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/motor/press" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/motor/press (no key)" "$code"
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/motor/click" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/motor/click (no coords)" "$code"
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/motor/launch" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/motor/launch (no app)" "$code"
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/motor/notify" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/motor/notify (missing fields)" "$code"
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/motor/volume" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/motor/volume (missing level)" "$code"
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/motor/open" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_4xx "POST /oca/motor/open (no url)" "$code"

post_json "POST /oca/intend" "/oca/intend" '{"intention":"smoke intention","triggerType":"event","triggerSpec":{"event":"api_smoke"},"priority":0.1}'
post_json "POST /oca/intend/complete (bad id → err)" "/oca/intend/complete" '{"id":-1}'

# Heavy / mutating — one-shot where safe
post_json "POST /oca/benchmark/run (may be slow)" "/oca/benchmark/run" '{"runSource":"smoke","notes":"automated","force":false}'
post_json "POST /oca/anti-decay/run" "/oca/anti-decay/run" '{}'
post_json "POST /oca/autonomic/run" "/oca/autonomic/run" '{}'
post_json "POST /oca/succession/manifest" "/oca/succession/manifest" '{}'
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/succession/reground/0" -H 'Content-Type: application/json' -d '{}' || echo 000)
line_missing_row "POST /oca/succession/reground/0 (no manifest)" "$code"

post_json "POST /oca/conventions" "/oca/conventions" '{"conventions":{},"reason":"smoke test no-op"}'
post_json "POST /oca/consent-review" "/oca/consent-review" '{"action":"acknowledged","notes":"smoke"}'

# Consolidation: 202 async
code=$(curl -sS -o /tmp/_oca_api_body.json -w "%{http_code}" -X POST "$BASE/oca/consolidate" -H 'Content-Type: application/json' -d '{}' || echo 000)
line "POST /oca/consolidate (202 async)" "$code"

line "POST /oca/llm-force-cli (SKIP mutate)" "SKIP" "not executed"
line "POST /oca/llm-reset (SKIP mutate)" "SKIP" "not executed"

echo
echo "=== Summary: ${GRN}pass=$pass${RST} ${RED}fail=$fail${RST} ${YEL}skip=$skip${RST} ==="
[[ "$fail" -eq 0 ]] || exit 1
