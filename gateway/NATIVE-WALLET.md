# Disabled-by-default native wallet reads

This candidate adds five **gateway-only** methods. The explorer read/cache surface is unchanged: `getnativewalletview`, `getnativepool`, `getnativebridgestate`, `getnativepoolquote`, and `getnativewithdrawalquote`. No laboratory method, global wallet snapshot, signer or additional broadcast path is exposed. Existing `sendrawtransaction` admission controls remain separate.

No deployment or activation is performed by this change. Do not enable before the reviewed native mainnet activation and custody process is complete. Node binaries must include `native-wallet-rpc`; their canonical committed-state operation gates remain authoritative.

Configuration requires all of:

- `NATIVE_WALLET_READS=enabled` (any other value disables).
- `NATIVE_WALLET_UPSTREAM` exactly one URL already in `EXPLORER_ARCHIVALS`.
- `NATIVE_WALLET_ACTIVATION`: JSON operational observation with schema `postern.native-gateway-activation.v1`, `format: BPOSMAN1`, exact official domain and genesis constants from `native-wallet.js`, 32-byte lowercase `head`, `stateRoot`, `activationProfileSha256`, decimal-string `activationEpoch` and `observedEpoch`, and millisecond integer `observedAt`/`expiresAt`. Observed epoch must reach activation; maximum epoch is forbidden; expiration is at most five minutes after observation. It is checked before and after forwarding.

This environment observation must be supplied by the reviewed deployment process from actual current network observations. A profile checker reporting `activationAuthorized:false` is **not** sufficient. The object is not a cryptographic activation receipt, does not verify operator approval signatures, and cannot substitute for canonical node gates. No automated refresh, approval verifier or production activation observation is included. Until that operational prerequisite exists, leave disabled.

Owner-scoped view params are exactly `[{ownerPublicKeyHex}]` (3749-byte key). Public pool reads take `[poolId]`, bridge reads `[assetId, routeId]`. Quotes use the exact native node request fields and canonical unsigned u64 decimal strings; arbitrary extra fields are rejected. Keys are structurally bounded at the edge; the node validates hybrid key encoding. An owner public key scopes data; it is not authentication or proof of possession.

Replies require pinned mainnet format/domain/genesis and canonical-shaped head/stateRoot/slot. Quotes additionally bind `expectedHead`; wallet contexts require an activated epoch. They are marked uncorroborated, one observer, `finalityVerified:false`. The configured activation observation is not a head lock: later canonical heads are allowed. Wallet review must still bind the request, snapshot, funding, fee and signing context.

Limits per isolate: one concurrent native read, burst two and sustained 0.5 calls/second, ten-second upstream deadline, existing one-MiB request envelope, two-MiB streamed response, 512-KiB snapshot, 256-KiB transaction, and 128 owner UTXOs. These gateway limits are intentionally tighter than the node's 4096-UTXO projection bound; oversized accounts fail explicitly, never truncate. No shared global-rate guarantee is claimed. Every reply is `no-store`; no retries, redirects, failover or shared owner cache. Upstream errors are preserved; malformed replies fail closed.

Tests: `node --test edge/tests/native-gateway.test.mjs edge/tests/gateway.test.mjs`.

Client pacing: 0.5 calls/second means one replenished token every **two seconds**, not every 500 ms. A burst of two calls can be consumed by view plus quote; a subsequent review refresh may return `native_read_capacity` until budget replenishes. The UI must present that refusal and let the caller retry explicitly with backoff. Do not automatically repeat signing or submission. The existing broadcast budget is separate; these settings do not authorize an additional send. Activation epoch zero is structurally permitted only when it is the actual reviewed configuration; it is not a default activation value.
