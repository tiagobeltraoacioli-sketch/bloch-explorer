# Simpler onboarding for nodes and validators — announced October 13, 2026

**Status: announced, not yet released.** The commands on this page ship with the next node release. Until that release is published under [Releases](/releases/), keep using the [current validator guide](/docs/validator-onboarding.md). This page will be updated with the release version and checksums when it is out.

**Network status:** finality on mainnet has been stalled since epoch 5402 (October 12–13). Do not start a new node or submit a validator deposit until finality is moving again. This page will say so when it is.

## What changes

Bloch is moving to the onboarding model Ethereum uses: no signing ceremony, and fewer manual steps.

| | Until now | With the next release |
|---|---|---|
| Starting a new node | Download a checkpoint envelope signed 2-of-3 by the Phase A signers, plus the signer-set file and its fingerprint | **Checkpoint sync:** name one or more node RPCs you trust; the node fetches the latest finalized checkpoint itself |
| Who signs checkpoints | The Foundation, Postern Labs and an external auditor, every 256 epochs | **Nobody.** You decide which nodes you trust, as on Ethereum |
| Becoming a validator | `validator-deposit prepare` with about 12 flags (hand-picked UTXOs, fees, expiry, RANDAO), then two `sign` runs and a manual `sendrawtransaction` | **One command:** `bloch-pos validator-join` |
| Nodes already running | Resume from their own finality | **Unchanged.** They keep their stored checkpoint and never consult the new options |

Consensus rules are **not** changed by this release: the 25,000 BLCH minimum, the 8-epoch activation delay, the four-activations-per-epoch limit and the 2,048-epoch withdrawal delay all stay as they are.

## Starting a node: checkpoint sync

```sh
bloch-pos run --data-dir /var/lib/bloch --genesis mainnet.manifest \
  --checkpoint-sync-url 139.180.166.5:8080,139.180.173.231:8080
```

- The node asks every listed RPC for its latest finalized checkpoint. All of them must agree and sit on the same genesis, or the node refuses to start and says why.
- It prints the block root it anchored to. Compare that root with the [explorer](/) or with another operator you trust. To pin it, add `--ws-trusted-root <block root>`.
- List nodes run by **different** operators when you can. A single endpoint works, but the node warns that it is trusting one node's word.
- The option is consulted only when the node has no recent finality of its own: a brand-new node, or one that was offline for about 11 days or more. A running node ignores it.
- Offline variant: `bloch-pos ws-checkpoint --operator-trusted --genesis mainnet.manifest --rpc A,B --epoch E --out cp` writes `cp.bin`; start with `--ws-trusted-checkpoint cp.bin`.

**What you are trusting.** Exactly what Ethereum's checkpoint sync asks you to trust: that the nodes you named are on the real chain. Every block after the checkpoint is still downloaded and validated by your node. A checkpoint can never reorganize a node that already has finality of its own. A checkpoint older than the weak-subjectivity window (2,016 epochs, about 22 days) is refused.

Signed checkpoint envelopes (`--ws-checkpoint`) are still accepted. They are simply no longer required, and no new ones are scheduled.

## Becoming a validator: `validator-join`

```sh
export BLOCH_KEYSTORE_PASSPHRASE_FILE=$HOME/.bloch-passphrase   # chmod 600

bloch-pos validator-join --genesis mainnet.manifest --rpc YOUR_NODE:8080 \
  --funding-dir $HOME/funding-key --validator-dir /var/lib/bloch
```

It:

1. creates the validator key in `--validator-dir` if there is none (the node runs from that directory);
2. checks that the RPC is on your genesis before signing anything;
3. reads the current epoch, base fee and your spendable outputs, and picks the largest ones first;
4. builds the deposit with these defaults: 25,000 BLCH stake, withdrawals and change to the funding owner, commission 0, maximum base fee twice the current one (only the actual fee is charged), valid for 64 epochs;
5. prints the full intent, signs with both keys and saves the signed transaction.

Nothing is sent until you run the same command again with `--send`. Optional settings: `--stake BLCH`, `--withdrawal SCRIPT_HASH`, `--commission BPS`, `--tip MILLISAT_PER_GAS`.

If your funding key and validator key are kept on separate machines, keep using the offline `validator-deposit prepare / sign` procedure in the [current guide](/docs/validator-onboarding.md). It is unchanged.

## Unchanged safety rules

- Never run the same validator key on two servers at the same time. Two copies sign two different votes for the same slot, and the chain bars that validator from fork choice permanently.
- Keep slashing protection with the key when moving a validator: stop the old node first, then start the new one.
