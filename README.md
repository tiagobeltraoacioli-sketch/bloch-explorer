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
- The dashboard's **peer globe** counts connections reported by monitored
  Genesis-4 nodes, with one dot per reported connection up to its rendering
  limit. Prometheus samples older than 90 seconds are excluded, and the globe
  clears when its latest reading expires. P2P and devnet subtotals appear only
  when both transport gauges cover every reporting node and sum to the total.
  The observability view also shows minimum, median and maximum connections
  per reporting node; all are subject to the same freshness check.
  The network and observability views also count monitored nodes with zero
  live peer sockets, using that same fresh-node filter.
  Connections can be counted by more than one observer; this is not the number
  of unique network nodes.
- The **network page** pairs fresh Prometheus connection aggregates with the
  separate RPC observer diagnostics. The connection panel expires with its
  oldest peer sample and polls only while the RPC nodes tab is open. Its trend
  chart can show six hours (5-minute steps), 24 hours (15-minute steps), seven
  days (hourly steps), or the current browser session. Missing historical points and changed reporter
  coverage break the line; the session chart restarts when coverage changes or
  the sampling gap exceeds 75 seconds.
  `GET /api/v1/observability/peer-history?period=6h|24h|7d` returns 73, 97 or
  169 fixed buckets, respectively. Each bucket reports aggregate connections and reporting-node
  count or explicit `null` when the fresh aggregate is unavailable. The endpoint
  accepts a period from that allowlist and exposes neither PromQL nor node labels.
  The network page summarizes sample coverage and exports the selected buckets
  as CSV with UTC timestamps and empty fields for missing readings.
  `GET /api/v1/observability/peer-distribution` returns the current, aggregate
  frequency of live socket counts per monitored node. It has no instance names,
  addresses, peer identities or arbitrary query surface.

## Develop

The complete English validator procedure is maintained in
[Start a Bloch validator — Genesis-4](public/docs/validator-onboarding.md).
The build renders that same Markdown source into the public **Run a validator**
page, so the repository document and the deployed instructions cannot drift.

The data expansion adds dedicated **mempool** (`/mempool`) and **network/RPC**
(`/network`) views, a latest-slot ribbon and optional `getbuildinfo` /
`gettxstatus` reads. See [data sources, RPC configuration and limits](docs/observatory-expansion.md)
for the endpoint contracts and the data still requiring an indexer.

Exchange systems can read `GET /api/v1/transactions/{txid}` for an indexed
Genesis-4 transaction. The response includes canonical receipt inputs and
outputs (`value_sat` decimal strings), block height and slot, inclusive
confirmations, and a finality flag based on a fresh corroborated chain head.
A 404 means the transaction is absent from the archival index; it does not
establish that a recently submitted transfer failed. A 503 means finality
cannot be established safely and deposit crediting should pause.
The current JavaScript SDK is available at
`https://ops-blochinc.xyz/wallets/downloads/blochprotocol-genesis4-sdk-0.1.13.tgz`
with SHA-256 `fe1d4178b47baa628f7a2fc629f2a5536d580d0f8863206eed7bc88209f63b4b`.
The older `/releases/genesis4-js/` archive remains a historical artifact.

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
