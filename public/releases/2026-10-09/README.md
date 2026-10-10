# Bloch Genesis-4 node — stable release 2026-10-09

**Required upgrade.** The network has run funded delegation since epoch 4669. Releases before this one
(2026-09-30 and older) cannot process funded-delegation transactions: they rejected the first such block
(slot 155,538, 2026-10-06 21:40:19 UTC) and continued on a separate branch. If your node's
`epoch - finalized.epoch` is far above 2, or its `finalized_height` is stuck near 124,005, it is affected.

| | |
|---|---|
| Source commit | `3a68f10bca501626dca54faab74a80a019057562` |
| Binary (Linux x86_64) SHA-256 | `22478fc5797ff673d390ed91b5b6a5120aa389b9bdbf798cf6b1abf99e60f7ba` |
| Same bytes as | `releases/2026-10-02-delegation-e4669-rc1` (two independent byte-identical builds) |
| Genesis manifest SHA3 | `f47d3e498ff978e34471dafff5f94fe139fc3ff489b1a00f469c030258311966` |
| Checkpoint | epoch 5120 — https://blochl1.com/checkpoints/epoch-5120/ (usable until about epoch 7136) |
| Transport / peers | `--transport devnet --peers 139.180.166.5:19100,139.180.173.231:19100` |

## Verify

```
sha256sum --check SHA256SUMS
minisign -Vm SHA256SUMS -p bloch-release-20260922.pub   # or rsign verify
```

## Upgrade an existing node

1. Stop the node and replace the executable with this one (same flags, same data directory).
2. Make sure `--peers` lists only the two bootnodes above.
3. Start it. If within ~30 minutes `getchaininfo` does not match https://blochl1.com/rpc and
   `epoch - finalized.epoch` does not return to about 2, clear the data directory and start from
   checkpoint 5120 with `--ws-checkpoint ws-envelope.bin --ws-signer-set signer-set.bin`.

Monitor `epoch - finalized.epoch > 4` as the divergence alarm.
