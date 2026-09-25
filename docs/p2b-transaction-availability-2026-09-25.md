# P2B transaction lookup availability — 2026-09-25

P2B reported intermittent HTTP 503 and excessively long pending requests from `GET https://blochl1.com/api/v1/transactions/{txid}`. This is a deposit-verification/listing blocker, not evidence that the transaction is missing. No alternate production transaction/finality endpoint was verified during this investigation.

## Evidence before the change

Representative TXID: `b68b74be02d0bc92d17fe4a7b7dfa69ffe720d84a9628ceb858d609af291a9f8`.

- At 20:41:10 UTC, the public endpoint returned HTTP 503, `Transaction lookup is temporarily unavailable`, in 9.624 seconds.
- A subsequent sequential sample at 20:41:52–20:42:13 UTC returned 12/12 HTTP 200 responses; measured durations were 507–4,845 ms. These short samples establish intermittency. They do not reproduce P2B's reported 1-in-20 success rate or measure an SLA.
- The receipt exists at height 92,540, slot 121,952. The primary indexer returned it. The other configured archival observer returned HTTP 405 for `/indexer/tx/{txid}`; RPC observer redundancy is not transaction-index redundancy.
- The old 7-second AbortController only covered the index fetch, while the parallel finality path had a separate, potentially longer budget. `Promise.all` waited for both before even handling a missing receipt. A cached status behind a newer index snapshot was refused without a fresh read.
- Production Pages revision `94fde0d` did not include the separately developed `d2b68ad` fix that renews archival evidence when an isolate restarts with a warm response cache. This release includes that tested fix and preserves the production System Map/frontend assets.

## Implemented behavior

One 10,000 ms application deadline covers index fetch, streamed body, corroborated head and at most one fresh head retry. A hard promise deadline prevents an ignored abort from holding the response open. Cancellation propagates to upstream reads; network/edge transport time is additional, so this is not an end-to-end latency SLA.

The receipt is validated before spending a finality read. Its body is bounded to 4 MiB while streaming. Identical overlapping requests from the same client/configuration share work; completed finality is never retained by this route. Distinct in-flight lookups are capped at 16 per isolate.

When a corroborated status is older than the index snapshot, the route bypasses the response cache once within the original deadline. It retains the existing two-slot maximum index lag and corroboration checks. If both sources claim the same height, their slot and tip hash must also agree. Missing/stale/divergent evidence remains HTTP 503; this patch does not turn unavailable finality into success or a cached finality claim. This is corroborated observation, not a new cryptographic inclusion proof.

The success schema is preserved: exact decimal-string `value_sat`, receipt anchors, inclusive `confirmations`, `status`, `finalized`, `finalized_height`, observed head and `corroboration`.

| HTTP | Meaning / client handling |
| --- | --- |
| 200 | Valid receipt with current corroborated status. `confirmed` is not `finalized`; apply the exchange's agreed credit policy. |
| 400 | `INVALID_TXID`; fix input instead of retrying unchanged. |
| 404 | `TX_NOT_INDEXED`; absent from the queried index, not proof of failed/nonexistent transaction. Reconcile later with discovery. |
| 429 | `LOOKUP_RATE_LIMITED`, `LOOKUP_BUSY` or `FINALITY_RATE_LIMITED`; `Retry-After: 1`. |
| 503 | `INDEX_UNAVAILABLE`, `INDEX_RECEIPT_INVALID`, `FINALITY_UNAVAILABLE`, `INDEX_LINEAGE_MISMATCH`, `LOOKUP_DEADLINE_EXCEEDED` or `LOOKUP_UNAVAILABLE`; `Retry-After: 2`. Defer crediting. |

GET responses include `X-Request-ID`, `X-Lookup-Budget-Ms: 10000` and `Cache-Control: no-store`. The retry headers are exposed to CORS clients. Failures retain their string `error` and add stable `code` and `retryable` fields. `TX_NOT_INDEXED.retryable=false` means no immediate transport retry, not no future discovery.

Limits are implementation limits, not reserved exchange capacity: transaction admission is an isolate-wide token bucket (40 burst, 15 requests/second refill); the shared RPC client budget is 40 burst / 8 cheap reads per second per client per isolate. A cache-behind-index retry uses another read. Shared archival/fleet governors also apply. Isolate-local counters are not a global rate guarantee.

Suggested acceptance-client settings, subject to agreement: 3-second connect and 12-second total timeout; at most two concurrent lookups and one request/second initially; honor Retry-After with jitter, then 2/4/8-second bounded retries, and defer to a durable queue after three retries. These are proposed settings, not a substitute for server availability or a load-tested entitlement.

## Verification and remaining acceptance work

Local: 207 tests passed, seven pre-existing node-source parity checks skipped, zero failures; fee parity, TypeScript and Vite build passed. Fifteen transaction tests cover the deadline at every stage, cancellation, cache/head race, invalid/oversized receipts, no finality downgrade, finality throttling, overlapping reads, concurrency limits, missing records and the actual corroboration engine after isolate recycling.

A public production acceptance result must be recorded separately after deployment. Required follow-up: redundant indexer serving the same replay-verified canonical data, readiness/lag checks and tested failover; regional latency/error metrics and alerts; an agreed P2B traffic envelope; mixed-TXID and recent/finalized transaction tests; cold-isolate, slot/epoch-transition and dependency-failure exercises; and a sustained observation window agreed with P2B. No zero-503 promise, 99.9% SLA, throughput entitlement, completion date or listing approval is asserted here.
