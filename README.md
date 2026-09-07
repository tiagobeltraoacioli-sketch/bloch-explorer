# Bloch Explorer

Block explorer for **Bloch Genesis-4**, a post-quantum proof-of-stake chain
(ML-DSA / Falcon signatures, 64 genesis validators, 30-second slots, finality
by epoch). Live at **https://blochl1.com**.

This repository is the source of the deployed site, extracted with its full
history from `apps/explorer` in the node monorepo
(`gitlab.com/blochsispow-group/bloch-pos`). The build here reproduces the
bundle served in production byte for byte.

## What it is

- A **React + Vite** single-page app (`src/`) with a live dashboard, pages for
  blocks and slots, epochs and chain analytics, transactions, hashes and
  outpoints, validators and their queues, finality, fees and mempool, supply,
  and the founder position with every denominator named. It is set in the same
  design system as the Bloch wallet — dark-first, one emerald accent, mono
  numerals, Fraunces for the display face — with a light theme behind the
  toggle in the top bar (`src/styles.css` documents the tokens and the rule
  that status colours never reuse the accent).
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

The fonts are bundled from npm (`@fontsource-variable/fraunces`,
`@fontsource/jetbrains-mono`) so the site depends on no third-party font host;
each face falls back to the system serif or mono stack if the file is blocked.

To look at the pages without a chain, serve `dist/` behind any mock of the edge
that answers `/rpc`, `/g4`, `/g4/slots` and `/g4/validators` — the shapes are
those in `edge/surface.js` and `functions/g4/`.

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
