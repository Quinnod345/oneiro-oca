#!/bin/zsh
# Before/after: how much of the system still reaches OpenClaw. Prints JSON.
#   evals/openclaw-removal/references.sh <before engine checkout> <after engine checkout> <before Mac Sources snapshot> <after Mac repo>
set -euo pipefail
BEFORE=${1:?before engine checkout}; AFTER=${2:?after engine checkout}; MAC_BEFORE=${3:?before Mac sources}; MAC_AFTER=${4:?after Mac repo}

count_lines() {  # files, lines: every line in tracked code that says openclaw (or the gateway), excluding cortex/ and the archived v1.2 README
  local dir=$1
  (cd "$dir" && git ls-files | grep -v -E '^(cortex/|docs/README-v1\.2-archive\.md)' | grep -E '\.(js|mjs|sh|swift|json|md|sql)$' | xargs grep -i -E 'openclaw|gateway\.js|createGateway|:18789' 2>/dev/null | wc -l | tr -d ' ')
}
runtime_lines() {  # lines that would actually reach OpenClaw at run time: CLI, port, ~/.openclaw, the gateway module
  local dir=$1
  (cd "$dir" && git ls-files | grep -v -E '^(cortex/|docs/|tests/)' | grep -E '\.(js|mjs|sh|swift)$' | xargs grep -E "\.openclaw|bin/openclaw|OCA_OPENCLAW|:18789|from '\./gateway\.js'|createGateway\(|'gateway', 'call'|'message', 'send'" 2>/dev/null | wc -l | tr -d ' ')
}
mac_lines() { grep -r -i -l -E 'openclaw|decideOnPhone|gatewayUp' "$1" --include='*.swift' 2>/dev/null | wc -l | tr -d ' '; }
present() { [ -e "$1" ] && echo true || echo false; }

cat <<EOF
{
 "engine": {
  "before": { "linesMentioning": $(count_lines "$BEFORE"), "runtimeReaches": $(runtime_lines "$BEFORE") },
  "after":  { "linesMentioning": $(count_lines "$AFTER"),  "runtimeReaches": $(runtime_lines "$AFTER") }
 },
 "macApp": {
  "before": { "swiftFilesReferencing": $(mac_lines "$MAC_BEFORE"), "phoneAppSwiftFiles": 666 },
  "after":  { "swiftFilesReferencing": $(mac_lines "$MAC_AFTER/Sources"), "phoneAppInRepo": $(present "$MAC_AFTER/mobile") }
 },
 "machine": {
  "openclawCommand": $(command -v openclaw >/dev/null 2>&1 && echo true || echo false),
  "openclawApp": $(present /Applications/OpenClaw.app),
  "dotOpenclaw": $(present "$HOME/.openclaw"),
  "personalReleases": $(present /Users/Shared/openclaw-personal-releases),
  "npmPackage": $(npm ls -g --depth=0 2>/dev/null | grep -q -i openclaw && echo true || echo false),
  "gatewayListening": $(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/startupz 2>/dev/null | grep -q '^2' && echo true || echo false),
  "archived": "$HOME/Archive/openclaw-2026-11-05"
 }
}
EOF
