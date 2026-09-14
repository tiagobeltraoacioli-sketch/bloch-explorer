# Read-quorum error migration

The explorer read proxy now returns `-32051` (`NO_QUORUM`) when archival
responses disagree. The node keeps `-32010` (`TX_REFUSED_SOURCE_CAP`). This
removes the collision without changing node transaction admission.

| Response | Client action |
| --- | --- |
| Explorer `-32051`, `data.reason: divergent_archivals` | Withhold credit; back off and retry. Do not switch to a less corroborated source to bypass disagreement. |
| Node `-32010` on transaction submission | Wait for capacity from that spend-authority source, then retry if still valid. This is not terminal invalidity and supplies no fixed `until_slot`. |
| Legacy proxy `-32010` on a read | During migration, classify using endpoint, method and error body. Withhold credit and retry. |

REST retains HTTP 503 for quorum disagreement. JSON-RPC retains its existing
HTTP behavior and error data. The explorer RPC transport preserves both new
and legacy errors without failing over. `getcapabilities` and
`/api/v1/capabilities` advertise version 1.2.0 and
`error_codes.no_quorum: -32051`, allowing rollout verification without inducing
an actual network disagreement.

Scope: the `bloch-explorer` Cloudflare Pages project, including `blochl1.com/rpc`.
`posternlabs.com/g4rpc` is a separate implementation. Its source and rollout
must be verified separately; deploying this project does not change it.

Validation: 90 tests passed, none skipped, including the cross-repository
node error-code collision check, divergent RPC/REST reads, and refusal to
fail over on both legacy and new errors. Production build passed.
