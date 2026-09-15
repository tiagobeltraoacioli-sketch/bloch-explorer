# Historical explorer integration — 2026-09-15

The historical index is now connected to transaction, address and outpoint pages.
Input values are retained after spending; fees come from consensus receipts;
funded validator stake is reported separately. Address history includes the
Genesis-4 opening ledger and all indexed creation/spend events. Historical
Genesis-3 activity before the carryover is outside this index.

The indexer source is in the node repository at commit `2d4073d`, under
`tools/bloch-indexer`. It reads the upgraded keyless archival's `archival-next`
log, replays the protocol's own transition, verifies signatures and checks every
block state root. It runs in its own read-only, resource-limited systemd service.
The explorer's Pages function allows only fixed-origin GET routes, bounds query
and response sizes, meters callers and returns unavailable rather than an empty
or fabricated result when the service fails.

Snapshot cursors survive new blocks. A replaced anchor returns HTTP 409 and
requires restarting pagination. The first address page now uses the same indexed
snapshot as its later pages. A previously active script hash with zero live
balance is recognized through its historical events. The explorer displays
ambiguous repeated transaction IDs as separate selectable block occurrences.

Transaction status remains an independent live query. Historical creation height
alone no longer produces an automatic “Settled” verdict on outpoint pages.

## Verification

- 124 edge tests pass, with no skipped tests, against the current node RPC source.
- The Rust indexer integration tests cover reorgs, intra-block spends, spent
  values, malformed input, exact large integers, >1,000 outputs and cursor
  conflicts. Consensus regression tests and the read-only receipt observer
  comparison pass; existing explicitly ignored consensus tests remain ignored.
- Real replay covered 70,405 blocks and 1,141 transactions in the initial run,
  with no undecodable transactions and successful state-root checks throughout.
- The example TXID
  `d7b1f414163dec0422fcfdcc109eeda8388f7d2980eaa00bedd3c4603d164301`
  records a 500,000,000-satoshi output, 2,166-satoshi fee, and retained details of
  its spent 4,000,000,000,000-satoshi input. Its other output is change.
- All 39,150 live outputs of the example source script were traversed across
  40 pages with no duplicates. Their exact sum, 3,741,843,621,677,442,063 satoshis,
  matched the live archival RPC. Its history contained 815,208 events at that
  snapshot. The recipient's nine outputs also matched its 1,800,000,000-satoshi
  RPC balance.
- Browser checks exercised the real indexed receipt, desktop/mobile layout,
  600 distinct UTXOs, history pagination, complete recipient history, retained
  spent-output value, and a controlled zero-balance/history fixture.

The index is rebuildable in memory: restarting replays the log before serving.
The initial measured rebuild took approximately eight minutes. A deep fork or
unrecoverable read/replay failure also triggers rebuilding with historical routes
unavailable meanwhile. The live transaction-status route remains separate.

Historical storage availability is separate from live network corroboration. If
the live head comparison fails, the API reports `lag_slots: null`; verified
historical receipts remain readable with their snapshot slot and source. This
does not grant any finality or deposit-crediting assurance.

The indexed transaction feed does not scan epochs through RPC in parallel.
Header scanning runs only when the historical service is unavailable. Address
history probes independently of the live balance request.
