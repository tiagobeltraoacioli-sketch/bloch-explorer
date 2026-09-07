# Bloch Explorer

Block explorer for **Bloch Genesis-4**, a post-quantum proof-of-stake chain
(ML-DSA / Falcon signatures, 64 genesis validators, 30-second slots, finality
by epoch). Live at **https://blochl1.com**.

This repository is the source of the deployed site, extracted with its full
history from `apps/explorer` in the node monorepo
(`gitlab.com/blochsispow-group/bloch-pos`). The build here reproduces the
bundle served in production byte for byte.

## What it is

- A **React + Vite** single-page app (`src/`) with pages for blocks, slots,
  transactions, hashes and outpoints, validators and their queues, finality,
  fees and mempool, supply, and the founder position with every denominator
  named.
- A **Cloudflare Pages Functions edge layer** (`functions/`, `edge/`) that
  sits between the browser and the chain. Every read is served from two
  keyless archival observers; a fleet validator is asked one question
  (`getchaininfo`) on a schedule to certify the lineage. Responses are cached
  by immutability class and the upstream call rate is capped by a governor,
  so public traffic can never become validator load. See `wrangler.toml` and
  `edge/pool.js` for the reasoning, in full.
- A **frozen RPC namespace** (`edge/surface.js`): every method the edge exposes
  is a written-out golden list, checked in both directions against the node's
  own `rpc.rs` so the edge cannot drift from the chain again.

## Develop

```sh
npm ci
npm run dev        # Vite dev server
npm run build      # fee check + tsc + vite build → dist/
npm test           # edge tests (node:test)
```

Node 22 or later is required (`--experimental-strip-types`).

Six tests compare the edge surface against the node source. In this
standalone repository they are **skipped** unless you point them at a
checkout of the node:

```sh
BLOCH_NODE_RPC_RS=../bloch-pos/crates/bloch-pos-node/src/rpc.rs npm test
```

Run them against the node commit the explorer was built for; a different
node branch will legitimately disagree.

## Deploy

Production is the Cloudflare Pages project `bloch-explorer`, serving
blochl1.com:

```sh
npm run build
npm run deploy     # wrangler pages deploy --project-name bloch-explorer --branch main
```

The upstream node addresses live in `wrangler.toml` `[vars]`, on purpose:
they override the dashboard on every deploy, and they are the public IPs of a
read-only public RPC. There is nothing secret in this repository.

## License

AGPL-3.0-or-later. See `LICENSE`.
