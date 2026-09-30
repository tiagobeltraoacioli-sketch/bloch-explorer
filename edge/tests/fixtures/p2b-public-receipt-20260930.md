# Public receipt compatibility fixture

`p2b-public-receipt-20260930.json` contains actual public responses captured on
2026-09-30, not generated transaction data:

- Receipt: `GET https://blochl1.com/api/v1/transactions/b68b74be02d0bc92d17fe4a7b7dfa69ffe720d84a9628ceb858d609af291a9f8`, completed at `2026-09-30T18:38:06.893719+00:00`.
- Head: `getchaininfo` at `https://blochl1.com/rpc`, completed at `2026-09-30T18:38:03.026276+00:00`.

The original collector record is
`observation-baseline-20260930T183758Z/round-0000.json`. The fixture retains
the parsed bodies and capture metadata. Each `response_sha256` identifies
the original HTTP body bytes, not this pretty-printed fixture.

The offline test strips only edge-derived finality fields from the REST
receipt, replays the remaining indexer fields, and provides the captured
head to the existing finality checks. It checks schema compatibility and
unchanged derived output. The recorded head is historical test input,
not current finality, independent operator evidence, cryptographic inclusion
proof, or proof of P2B crediting.

The source contract is `tools/bloch-indexer/src/explorer.rs::transaction`,
`src/model.rs::TxRow` and `src/json.rs::Json::sat` in the Bloch L1 release
source at `f40a04c3ee36b03161d6b015e5eb6f283cde48ce`.
Individual input/output amounts are decimal-string u64 values;
fee and stake aggregates are u128, with a nullable unknown fee. Inputs
name spent outpoints. Output indices are enumerated from zero.

The REST boundary preserves optional auxiliary fields and optional output
txids while validating every supplied value. Empty sides and an unknown
fee remain valid for transaction kinds and incomplete input valuation
supported by the indexer. Schema validation does not establish conservation,
authenticate the indexer, or provide a second indexer source.
