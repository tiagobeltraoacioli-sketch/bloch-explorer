# Bloch L2 explorer (blochl1.com/l2)

Public URL: **https://blochl1.com/l2** (chain explorer for Bloch L2, EVM, chain id 700770).
Pages: `/l2`, `/l2/blocks/<from>`, `/l2/block/<number|hash>`, `/l2/tx/<hash>`, `/l2/address/<0x…>`.

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

    npm run test:l2                                     # unit tests
    L2_LIVE_URL=http://127.0.0.1:19145/ L2_LIVE_CHAIN_ID=700771 npm run test:l2   # plus live devnet4
    npm run build && L2_RPC_URL=http://127.0.0.1:19145/ L2_CHAIN_ID=700771 PORT=19160 npm run preview:l2
    scripts/deploy-l2-explorer.sh check      # preflight: clean tree, L2 RPC answers 700770, tests
    scripts/deploy-l2-explorer.sh deploy     # build + wrangler pages deploy + verify
    scripts/deploy-l2-explorer.sh verify

`L2_RPC_URL` (wrangler.toml) defaults to `https://l2rpc.blochl1.com/`. It must be a hostname (not a bare IP);
a Worker gateway on the same zone must use a Custom Domain.
