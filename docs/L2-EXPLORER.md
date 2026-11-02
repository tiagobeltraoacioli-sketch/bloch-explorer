# Bloch L2 explorer (blochl1.com/l2)

Public URL: **https://blochl1.com/l2** (chain explorer for Bloch L2, EVM, chain id 700770).
Pages: `/l2`, `/l2/bridge`, `/l2/blocks/<from>`, `/l2/block/<number|hash>`, `/l2/tx/<hash>`, `/l2/address/<0x…>`.

## Two sources

1. **The L1 settlement record**, `GET /l2status` (`functions/l2status.js`, policy in `edge/l2status.js`). It reads
   `getl2settlement` from every L1 observer in `EXPLORER_ARCHIVALS` + `EXPLORER_FLEET` and serves the newest answer of
   the largest group that agrees on the settlement fields (fields that move with the L1 head are ignored for agreement:
   `native_height`, the finalized checkpoint, the release-window index, per-record `finalized`/`claimable`/`matured`).
   The answer says how many observers agree; two are required for "corroborated". The `/l2` status panel and
   `/l2/bridge` show from it: activation (source slot/epoch), the accepted settlement (decoded statement: L2 number,
   header hash, source slot, consumed deposit range, withdrawal root/count), escrow and its conservation flag, the
   deposit inbox and pending deposits, the withdrawal tree, claimable roots, claimed count, delays, release window and
   the attestor set with its claim threshold.
2. **The settled L2 RPC**, `POST /l2rpc`, read in **settled-only** mode (`L2_SETTLED_ONLY`, default on): `latest` and
   `pending` are rewritten to `safe`, every batch carries one `eth_getBlockByNumber("safe")` probe, and any block,
   transaction, receipt or log above that bound is answered as absent (`eth_blockNumber` answers the safe number;
   state reads above it get `-32001`). The pages apply the same bound client-side and say so.

"Latest settlement finalized" combines both: the L2 RPC's `finalized` block compared with the accepted statement's
L2 number. When the L2 RPC is unreachable the page says the RPC is not live and still shows the L1 record.

Not yet live (2026-10-30): the L1 record says activated at slot 187200 (epoch 5850), `accepted = null`, escrow 0,
no withdrawals, attestor set `1c06adbb…cc4b`; `l2rpc.blochl1.com` has no DNS record. `/l2` shows exactly that.

## Design

- Part of the existing Pages project `bloch-explorer`; no database, no indexer.
- The browser calls the same-origin `POST /l2rpc` (`functions/l2rpc.js`, policy in `edge/l2rpc.js`). It forwards
  allowlisted read calls to `L2_RPC_URL` (the public L2 RPC) and refuses every answer when the upstream's
  `eth_chainId` is not `L2_CHAIN_ID`. Writes, filters, subscriptions, debug/admin methods and arbitrary `eth_call`
  are refused (`eth_call` only for ERC-20 `name`/`symbol`/`decimals`/`totalSupply`/`balanceOf`).
  `GET /l2rpc` describes the endpoint.
- Finality badges are the L2 RPC's own tags: **Latest** (executed), **Safe** (settlement accepted at the L1 head),
  **Finalized** (settlement in an FFG-finalized L1 block, from `bloch_finality`).
- Token transfers (ERC-20/721) come from `eth_getLogs` over the whole chain. Native transactions of an address are
  found by reading blocks (2,000 per step, range shown on the page): the RPC has no address index.

## Settlement link

Each block page links the L1 finalized checkpoint (`/slot/<n>`). The exact L1 block holding a given L2 block's
settlement is shown when the L2 RPC serves `bloch_settlement`. Proposed method for `bloch-l2-settled-rpc`
(the follower status already has the data in `finalized_settlements[]`):

    bloch_settlement("0x<l2 number>") ->
      {"l2_number": N, "l2_hash": "…", "commitment": "…", "native_slot": S, "native_block": "…"} | null

Until then the page says the per-block L1 location is not reported.

## Run and deploy

    npm run test:l2                                     # unit tests (l2 + l2-settled)
    PORT=19171 MODE=genesis node scripts/l2-mock-rpc.mjs   # loopback mock of the settled RPC (genesis | nostatus | ahead)
    L2_RPC_URL=http://127.0.0.1:19171/ PORT=19160 npm run preview:l2   # /l2status reads the real L1 observers
    L2_STATUS_FIXTURE=edge/tests/fixtures/getl2settlement-mainnet-20261030.json ...  # or a recorded L1 record
    L2_LIVE_URL=http://127.0.0.1:19145/ L2_LIVE_CHAIN_ID=700771 npm run test:l2   # plus live devnet4
    npm run build && L2_RPC_URL=http://127.0.0.1:19145/ L2_CHAIN_ID=700771 PORT=19160 npm run preview:l2
    scripts/deploy-l2-explorer.sh check      # preflight: clean tree, L2 RPC answers 700770, tests
    scripts/deploy-l2-explorer.sh deploy     # build + wrangler pages deploy + verify
    scripts/deploy-l2-explorer.sh verify
    ALLOW_RPC_NOT_LIVE=1 scripts/deploy-l2-explorer.sh deploy   # publish the not-yet-live state (L1 record only)

`L2_RPC_URL` (wrangler.toml) defaults to `https://l2rpc.blochl1.com/`. It must be a hostname (not a bare IP);
a Worker gateway on the same zone must use a Custom Domain.
