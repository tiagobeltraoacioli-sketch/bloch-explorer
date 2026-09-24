# Graphus System Map in Bloch Explorer

The native `/system-map` route is linked from the atlas, chain dashboard, navigation drawer and footer. It loads the central Graphus module registry through `GET https://bloch-graphus.xyz/api/system/map`. The schema has a version, module descriptions, asset support, implementation/access status, typed dependencies and per-asset action links. Status describes implementation, not continuous source health or an executed analysis. Private capabilities open the authenticated portal.

## Source path

Captures call `GET https://bloch-graphus.xyz/api/chain/network?asset=BTC|ETH|BLCH|USDT|USDC`, optionally with the returned `cursor`. These are direct browser requests with credentials omitted and redirects refused. Both public endpoints support read-only CORS. The explorer does not proxy a capture through its own Worker: Graphus's BLCH adapter reads `blochl1.com/indexer`, and a server-side proxy would create a circular Worker request. No account credentials, private scores or API keys cross this integration.

The registry decoder bounds bytes, module/connection counts and strings, rejects unknown schema versions, duplicate IDs and unresolved dependencies, and restricts action links to the four known product origins. Captures use a 65-second request deadline and the same evidence validation as the Graphus workbench. Source failures remain explicit; no synthetic sample replaces a failed read.

## Features

- Responsive module diagram and directory, asset/layer/status/search filters, selectable dependency contracts, input/output/coverage inspector, upstream/downstream navigation and shareable module links.
- Fit, zoom, pan, selected-module focus and a native expanded-workspace dialog. Compact screens use a details dialog. Every module remains reachable without horizontal page overflow.
- Manual capture of one, two or four source pages per batch; continuation is capped at eight pages, 1,200 references, 4,000 records and 3 MB. Partial failures and cancellation keep completed pages. Changing the capture asset clears the current collection and baseline and invalidates pending responses.
- Source, retrieval time, highest sampled anchor, original page anchors, finality text, completeness counts and dataset SHA-256.
- Search by public reference or transaction, record-type/direction/block-range filters, exact integer amount bounds, separate sums per record type and paginated source records. Bitcoin base58 matching remains case-sensitive. BLCH transaction links pin the selected block occurrence.
- A graph of the matching captured records: up to 220 references and 800 directed event records. Addresses, scripts and transaction references remain distinct. Display omissions are counted; JSON exports retain all matching records. Graph links describe observed records, not ownership or continuity of value.
- Full and filtered `graphus_network_collection` exports preserve exact base-unit strings and source lineage. Filtered packets include the parent digest and can be opened through Graphus's existing JSON import. No cross-origin session-storage handoff is claimed.
- Immutable tab-memory baseline, record difference counts and baseline/comparison JSON exports. Absence from a bounded sample does not establish inactivity or deletion. Captures are not persisted across page closure/reload.

## Shared evidence code

`src/vendor/graphus/system_evidence.js` and `analytics_engine.js` are byte-identical copies from the user's `bloch-inc-porb` repository at the revision recorded in `provenance.json`. They run locally as bundled code; remote API responses cannot supply executable code. The accompanying TypeScript declaration describes the integration contract. Refresh both files deliberately and update the source revision/checksums when adopting a new evidence schema. Unit tests check their bytes against the recorded SHA-256 values.

## Verification

```sh
npm test
npm run build
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/verify-system-map.mjs
EXPLORER_ORIGIN=https://blochl1.com PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/verify-system-map.mjs
```

The local browser run uses clearly named fixtures at the API boundary. It checks the four viewport widths (1,440, 1,280, 1,024 and 390 px), module clicks/dialogs, no implicit source capture, all five asset contracts, validated exports, searches, graph inspection, themes, baseline comparison, partial failures, cancellation, asset-switch races and registry failure/retry. Production mode uses actual Graphus APIs. `SYSTEM_MAP_ASSETS` can select a comma-separated subset when repeating a source check. Screenshots are written outside the repository to `/private/tmp/bloch-system-map/`.

The existing explorer suite also verifies the unchanged RPC/indexer contracts. Node-source parity checks require a matching node checkout and are reported as skipped when unavailable. Production uses the existing `bloch-explorer` Pages project; deploy the Graphus API release before the explorer frontend.
