# Graph intelligence atlas

The homepage is a responsive evidence atlas; the complete previous chain dashboard
remains at `/chain`. Existing block, transaction, validator and Graphus routes remain.

## Sources and scope

- `/rpc`: corroborated chain head and 24 recent slots, through the existing bounded
  archival edge. The consensus graph uses only observed proposer and parent fields.
- `/indexer/transactions?limit=48`: canonical historical receipts. eUTXO edges mean
  consumed/created outpoints. The script projection is a transaction–script incidence
  graph, not an inferred payment flow. Receipt links pin the indexed block.
- `/indexer/holders?limit=64`: top funded script references, exact decimal satoshis,
  denominator from the same snapshot. Stake and delegation are outside this total.
- `/research?period=6h|24h|7d`: a Space-compatible envelope over the same bounded telemetry
  producer used by Bloch Space. Its public series itself calls this explorer, so
  the atlas calls `handlePeerHistory` directly to avoid circular Worker requests.
  Two fixed aggregate Prometheus queries have six-second timeouts; the response
  is cached for up to 60 seconds. No arbitrary URL, PromQL or query is accepted.
  The response explicitly names the shared producer and both public source URLs.
- `/system-map`: native integration with the Graphus module catalog and bounded
  real public-chain APIs. Captures are manual and include BTC, Ethereum, tokens and
  Bloch. See [the integration contract](system-map-integration.md). Public captures
  contain no holder attribution or private scores.

Bloch Space shares the underlying network telemetry with the explorer. It is not
independent corroboration. Missing buckets stay missing; plots break at changes in
reporter counts. Source receipt times and indexed slot/height are separate labels.
Sources fail independently and retain explicit last-snapshot status on failures.

## Graphs and quantitative panels

Four graph panels show outpoints, script incidence, proposer/block ancestry and
ranked balances. The first three support selection, evidence links, pan, zoom and
keyboard activation. Force/radial layouts encode relationships, not location.
Outpoint views show at most 16 IO records per side per transaction; both receipt
graphs cap at 650 nodes and 1,600 edges and report omitted records. Bubble radii use
log scales; exact values remain available in records and exports.

Six further panels show connections, reporter coverage, held-out model predictions,
transaction clusters, model residuals and cumulative indexed balance shares.
Charts provide pointer inspection and keyboard sample scrubbers. JSON receipt and
model exports and CSV observations include actual source records, with empty CSV
fields for missing observations.

## Machine learning

The temporal model is ridge AR(3), λ=1, with training-only mean/scale normalization.
The first 24 eligible lag windows train the initial model. Each subsequent window
is predicted using only previous training windows. All four samples in an eligible
window must be present and have the same reporter count. Separate eligible windows
may contribute to training. At least 32 windows are required; this leaves at least
eight held-out predictions. The comparison is one-step persistence. MAE and skill
are reported even when the model loses. Zero-error baselines have undefined skill.
The next-step estimate is conditional on unchanged coverage. Residual p95 is a
descriptive diagnostic, not a calibrated anomaly threshold or probability.

K-means uses standardized log(1+inputs), log(1+outputs), log(1+total output satoshis),
deterministic farthest-point seeds, up to three centers and 40 iterations. At least
eight receipts are required. Groups describe the currently filtered sample's
structure, not identity, ownership, money flow or risk. Outputs include change.

## Validation

`npm test` covers source validation, exact monetary amounts, bounded graphs,
missing-data/coverage behavior, no look-ahead in evaluation, constant series,
deterministic clustering, pinned receipt occurrences and the shared-source route.

After `npm run build`, `scripts/verify-atlas.mjs` starts a temporary local server
with production read-only sources. Set `PLAYWRIGHT_MODULE` to the installed
Playwright entry point and optionally `CHROME_PATH`. It checks live graph selection,
zoom, filters, range switching, CSV export, dark/light themes, mobile overflow and
explicit source outages. Screenshots are saved under `/private/tmp/bloch-atlas-*`.

Production uses the existing `bloch-explorer` Cloudflare Pages project and release
procedure. No consensus, validator deployment, wallet write path or node RPC
allowlist is changed by the atlas.
