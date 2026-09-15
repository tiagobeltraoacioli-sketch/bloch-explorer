# Transaction IDs remain visible without a historical index

Opening `/tx/d7b1f414163dec0422fcfdcc109eeda8388f7d2980eaa00bedd3c4603d164301`
previously showed an obsolete explanation that transaction lookup was impossible.
The page only queried the optional indexer; the deployed `/indexer/health` returned
SPA HTML. During investigation both `/rpc` (`gettxstatus`) and
`/api/v1/tx-status/<id>` returned `justified` from `archival-1` for this ID.

Transaction pages now query observer status immediately and independently of the
historical index. Visible pages refresh every 15 seconds, with pause and manual
refresh controls. Failed reads and stale cache entries label previous observations;
`unknown` never means transaction failure or absence. Status remains explicitly
node-local, not an independently verified finality proof. Full inputs, outputs,
fees and block details still require the historical index.

The transactions overview offers a status lookup. Manual lookup results retain
the ID actually queried, and editing the input cancels an in-flight request.
The mobile search header wraps rather than overflowing the viewport.

Validation: 120 tests passed with no skips, using the deployed-lineage node RPC
registry; TypeScript, fee consistency and the production build passed. A WebKit
browser run exercised direct TXID navigation while indexer health returned HTML,
status refresh, stale-error labeling, navigation to a different ID, search routing,
and a 390px viewport with no horizontal overflow. No node binary or consensus
configuration was changed.
