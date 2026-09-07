# Explorer data and RPC expansion

This update keeps the Genesis-4 explorer and its existing Pages Functions
architecture. It adds a working chain overview, a dedicated mempool view,
network diagnostics and two optional node RPC methods. It does not deploy new
nodes, invent transaction data or change consensus.

## User-facing views

| View | Data and behavior |
| --- | --- |
| `/` | Latest-slot ribbon, pending transactions, next base fee, observed transaction activity and block production. Existing checkpoint, validator, supply and slot-table panels remain. |
| `/mempool` | Pending count, capacity, bytes, average payload, next base fee, barred entries, rejected re-offers, expirations and low-fee evictions when reported. A session-only history retains at most 120 samples; it resets across observer changes, reorg salts and sampling gaps. |
| `/network` | Configured observers and witnesses, passive latency/failure measurements, sample ages, observed head slots, optional build identities, searchable method catalogue and API reference. |
| Transaction status form | Validates a 64-hex transaction ID and asks one observer's remembered status. `unknown` never means proven absent. |

The shared graphite/emerald theme includes a separate blue finality color and
amber pending state, a light theme, responsive layout, keyboard-operable
controls, explicit empty/error states and reduced-motion behavior.

## Added read surface

| Endpoint | Source | Semantics |
| --- | --- | --- |
| `POST /rpc`, `getbuildinfo`, `[]` | Optional node RPC | Self-reported build version, commit provenance, source digest, compiler and target. Node-local, cached 60 seconds. |
| `POST /rpc`, `gettxstatus`, `[txid]` | Optional node RPC | Pending/included/justified/finalized/unknown as remembered by the answering observer. Node-local, cached 4 seconds. |
| `GET /api/v1/build` | Governed `getbuildinfo` | Existing API envelope with source and cache age. |
| `GET /api/v1/tx-status/<txid>` | Governed `gettxstatus` | Same semantics and validation as the RPC. |
| `GET /api/v1/network` | Governed head and optional build reads; passive pool measurements | Partial results remain useful if a method is absent. A failed primary read skips optional work. No caller-controlled upstream URLs. |

The frozen edge catalogue grows from **15 to 17** methods. The two additions
are explicitly optional; older nodes returning `-32601` remain supported.
During a mixed-version rollout a successful optional response can be used,
with the identity of its actual observer. It is never promoted to consensus
agreement. All other branch-sensitive disagreement rules remain in force.

The new method names and response fields were checked against
`crates/bloch-pos-node/src/rpc.rs` in the available `bloch-sis-pow` checkout
(base commit `72bcb15c20b8880edac8ee516d69d3a4f90d4c11`): `route`,
`build_info_json`, `tx_status_json` and `mempool_info_json`. That lineage
differs from the original explorer's `bloch-pos` frozen-surface lineage.
Source availability is not evidence of deployment: production support must
be observed, and the UI exposes that distinction.

## More archival RPCs

Configure `EXPLORER_ARCHIVALS` and `EXPLORER_FLEET` in the existing
`wrangler.toml` deployment configuration. Entries are comma/whitespace
separated HTTP(S) URLs. Defaults remain the existing two observers and seven
scheduled witnesses. This change does **not** claim to provision more servers.

- Each pool is capped at eight nodes. Eight archival state scans cost 40
  upstream tokens, within the existing 60-token burst. The sustained budget
  remains unchanged at 25 tokens/second per edge isolate.
- URLs are normalized and deduplicated. Invalid schemes, URL credentials,
  fragments and oversized pools are rejected.
- A configured observer cannot share a hostname with a configured or known
  default fleet validator; direct-IP and the existing `.nip.io` form are
  treated alike. Operators must still verify the role of every added node.
- A larger pool must agree across **all** observed heads. Comparing only the
  first two could hide disagreement from a third observer.
- Public reads still use observers. Validators only receive the existing
  scheduled `getchaininfo` witness requests. No write RPC was added.
- Diagnostics use pseudonymous pool positions and whitelisted build fields;
  upstream URLs, credentials and arbitrary node metadata are not included in
  the node table. Measurements are passive, local to an edge isolate and reset
  when it recycles; they are not a global uptime SLA or independent operators.

## Accuracy and operational safeguards

Node-local cache entries retain their selected observer identity. Monetary
strings and large integer counters avoid floating-point conversion. Missing,
zero and invalid fields are distinct. Frontend reads have deadlines; new
polling pauses when hidden, supports manual pause/refresh and backs off after
failures. Dashboard polls no longer overlap. Coalesced JSON-RPC replies now
preserve each caller's request ID, and the client rejects malformed envelopes
and failed HTTP responses instead of returning an undefined success.

## Remaining data requirements

Full mempool.space-like transaction history, address history, per-transaction
fee distributions and projected-block ordering need data the currently
documented Genesis-4 RPC does not expose. Existing transaction/indexer views
are preserved and use the existing `VITE_BLOCH_INDEXER` integration. This
change does not create a durable indexer, historical telemetry database,
WebSocket feed, fee-priority estimator or new validator/observer deployment.

## Validation

Run `npm test` and `npm run build`. The expansion adds tests for mixed node
versions, source retention through cache, input rejection before upstream
calls, partial diagnostics, URL privacy, bounded pools, three-observer
disagreement, coalesced IDs, safe arithmetic, history continuity and RPC
transport failures/timeouts.

The six pre-existing cross-repository tests still require the matching
`BLOCH_NODE_RPC_RS` source and are reported as skipped when it is absent.
Build and deterministic tests do not establish production connectivity or
visual browser QA. Merge and deployment remain separate steps through the
repository's existing release process.
