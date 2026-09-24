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

### Published release — 2026-09-24

Explorer release `d407c8cb` publishes source commit `5e9fab4` at `https://blochl1.com/system-map`. The companion Graphus API release is `d574fa04`, source commit `1c6df13`. The Explorer release starts from the previously deployed `db13541`; it does not include the separate unpublished gateway change on another local branch.

Local verification: 189 Explorer tests passed, seven existing node-source parity tests skipped, no failures; TypeScript/Vite build passed. The five-asset local WebKit harness passed, including baseline, partial failure, cancellation and late-response handling. All 27 selected Graphus API/registry/evidence tests passed.

Production WebKit verified all 44 modules at 1,440, 1,280, 1,024 and 390 px, actual selection, filters, dialogs, expanded view and no horizontal overflow. A separate homepage check followed the System Map link into the native route. Real captures, reference search, graph inspection and full/filtered exports validated these bounded observations across separate runs:

| Asset | Records | References, including transaction nodes | Dataset SHA-256 |
| --- | ---: | ---: | --- |
| BTC | 75 | 81 | `b5bf5b9a86496c77fd5def69c25300a89f0be581d3bbc96bc43bad6c9f59a0b7` |
| ETH | 24 | 42 | `b5f1275de33cabd1837a0d3f7bc4f5bfefcd1628d35eb4483c2b7973f90a5c20` |
| BLCH | 844 | 49 | `821aef60a6bcd631c1476920c0a5314dcad39ca165c58563fb1b67d6b107b35f` |
| USDT | 193 | 264 | `c2e4532a9c66285238bd1088f1abac0ed55e837cba127e37aad7c6e4501681e7` |
| USDC | 278 | 257 | `de7c7e57c06196c4599d4e5270d21406a9eda2268d2d49e7f1fa85d889917f86` |

These are source samples, not synchronized network totals. Navigation, inspection, filtering and export made no additional source reads. Live phone inspector and light-theme graph screenshots were inspected.

Initial token requests encountered intermittent HTTP 502 responses. The custom domain sometimes returned a Cloudflare plain-text error without CORS; the release URL returned the API's CORS-enabled `chain_source_unavailable` response. Later browser requests returned valid USDT/USDC samples. Failures were shown explicitly and did not create substitute data. The two targeted token runs completed the System Map interactions but failed the harness's final zero-page-errors assertion because the existing header RPC fallback at `posternlabs.com/g4rpc` reported browser access-control failures. This is not a completely green production smoke test or an availability guarantee; the gateway/fallback implementation was unchanged by this release.

Content verification fetched the production asset URLs from the served HTML and compared their bytes to the local build:

| Asset | SHA-256 |
| --- | --- |
| `index-D10mxTuo.js` | `3675d467106e42e2d0c09a6801c67a2c92406d73bb04d9debb43746e87fbab2b` |
| `index-JSoYUbhk.css` | `2bc14ac96ceb49016117e3ce9529efe3b87d1db1d0a53f05f2d11a4da413019a` |
| `SystemMap-Bk-tGsS_.js` | `f608e7a97f96cf4e82cd819990df89f90526aa3739e55639c5114bd2cff1cd84` |
