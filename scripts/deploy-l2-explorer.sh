#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Publish blochl1.com with the /l2 explorer (Bloch L2, chain id 700770).
# Run by the operator; nothing here runs automatically.
#
#   scripts/deploy-l2-explorer.sh check    # preflight only (default)
#   scripts/deploy-l2-explorer.sh deploy   # preflight, build, wrangler pages deploy
#   scripts/deploy-l2-explorer.sh verify   # check the live site after a deploy
#
# This deploys the WHOLE Pages project bloch-explorer from this tree, so the
# tree must contain whatever blochl1.com currently serves (this branch is cut
# from d4780b5, the head of feat/graph-intelligence-explorer-20260924). If that
# branch moved, rebase this branch onto it first.
set -euo pipefail
cd "$(dirname "$0")/.."
mode=${1:-check}
site=${SITE:-https://blochl1.com}
rpc=$(sed -n 's/^L2_RPC_URL = "\(.*\)"/\1/p' wrangler.toml | awk '{print $1}')
want=$(sed -n 's/^L2_CHAIN_ID = "\(.*\)"/\1/p' wrangler.toml)
hexwant=$(printf '0x%x' "$want")

probe() { # url -> chain id hex or empty
  curl -sS -m 15 -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$1" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("result",""))' 2>/dev/null || true
}

preflight() {
  echo "L2_RPC_URL=$rpc  L2_CHAIN_ID=$want"
  [ -z "$(git status --porcelain)" ] || { echo "tree is dirty; commit first" >&2; exit 1; }
  got=$(probe "$rpc")
  if [ "$got" != "$hexwant" ] && [ "${ALLOW_RPC_NOT_LIVE:-0}" = 1 ]; then
    echo "L2 RPC $rpc is not live (answered '${got:-nothing}'); ALLOW_RPC_NOT_LIVE=1: /l2 will show the L1 record and say the RPC is not live." >&2
    npm test || echo "WARNING: full suite has failures; three g4-errors tests already fail on 3e2e3fc. Review before deploying." >&2
    npm run test:l2
    return 0
  fi
  if [ "$got" != "$hexwant" ]; then
    echo "L2 RPC $rpc answered chain id '${got:-nothing}', expected $hexwant." >&2
    echo "Wait for the public L2 RPC or set ALLOW_RPC_NOT_LIVE=1 to publish the not-yet-live state." >&2
    exit 1
  fi
  head=$(curl -sS -m 15 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$rpc" | python3 -c 'import json,sys; print(int(json.load(sys.stdin)["result"],16))')
  echo "L2 RPC ok: chain $want, settled head block $head"
  npm test || echo "WARNING: full suite has failures; on d4780b5 three g4-errors tests already fail (fork-B pins). Review before deploying." >&2
  L2_LIVE_URL="$rpc" L2_LIVE_CHAIN_ID="$want" npm run test:l2
}

verify() {
  echo "GET $site/l2status"
  curl -sS -m 30 "$site/l2status" | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k: d[k] for k in ("responding","agreeing","corroborated")}); assert d["corroborated"] and d["settlement"]["chain_id"]=='"$want"
  if [ "${ALLOW_RPC_NOT_LIVE:-0}" = 1 ]; then echo "OK: $site/l2status is corroborated (L2 RPC not checked)"; return 0; fi
  echo "GET $site/l2rpc"
  curl -sS -m 15 "$site/l2rpc" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d); assert d["configured"] and d["chainId"]=='"$want"
  got=$(probe "$site/l2rpc")
  [ "$got" = "$hexwant" ] || { echo "$site/l2rpc answered chain '${got:-nothing}' (1003 means L2_RPC_URL is an IP or an unreachable same-zone Worker)" >&2; exit 1; }
  code=$(curl -sS -o /dev/null -w '%{http_code}' -m 15 "$site/l2")
  [ "$code" = 200 ] || { echo "$site/l2 answered HTTP $code" >&2; exit 1; }
  echo "OK: $site/l2 is live and reads chain $want"
}

case "$mode" in
  check) preflight ;;
  deploy) preflight; npm run build; npm run deploy; sleep 5; verify ;;
  verify) verify ;;
  *) echo "usage: $0 check|deploy|verify" >&2; exit 2 ;;
esac
