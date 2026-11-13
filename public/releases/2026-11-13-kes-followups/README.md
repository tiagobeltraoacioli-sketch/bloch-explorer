# Bloch PoS node — 2026-11-13 (mandatory before epoch 8620)

This directory contains the Linux x86-64 node binary built from commit
`906336fd35f157dac380523b59dee8a5a325175a` in the canonical release container
(`deploy/pos-release/Dockerfile`, `scripts/build-pos-release-container.sh`).

Binary SHA-256:

```text
dfe9ce67eb265c3cca9309bf68ce6537ce5637251d3c7691c3532de59cbc440e
```

Verify the signed checksum before installing:

```bash
minisign -Vm SHA256SUMS -p bloch-release-20260922.pub
sha256sum --check SHA256SUMS
./bloch-pos --version
```

The expected version is:

```text
bloch-pos-node 0.1.0-mainnet (906336fd35f157dac380523b59dee8a5a325175a)+ws-release-anchor (Genesis-4, block version 0xb10c0005)
source-digest sha3-256:1d4749ea23d62d8a22967a9775ac49432aaa791dff08decdab768e3eb97e96fd (372 files, 11015470 bytes) commit-source:asserted tree:asserted-clean
```

**Mandatory upgrade. Deadline: epoch 8620, 2026-11-17 16:11 UTC.** Every
node — validators, observers and exchange nodes — must run this release
before that epoch. A node still on an earlier release (`78d4921c`,
`7f1c116e`) can leave the canonical chain from epoch 8620 on.

**What changes at epoch 8620.** KES enforcement (HF3) activates at epoch 8620
as scheduled by the October 29 release. This release arms two follow-up
rules of that fork at the same epoch:

- **Vote slot-epoch binding.** A block carrying a vote whose target epoch is
  not the epoch of its slot is invalid. Honest validators have always set
  the two equal, so no honest vote is affected.
- **KES first-key floor.** A period that precedes a validator's first KES key
  resolves to its static key, so a validator that registers its first KES
  key after the bind keeps signing until that key starts.

Nothing changes before epoch 8620: a full replay of mainnet history with
this binary reproduces the canonical chain bit for bit (same head, same
state root), and until the activation epoch this release follows the same
chain as `7f1c116e` and `78d4921c`.

**Also in this release.**

- Everything in the November 12 security hardening release (`7f1c116e`).
- `--reject-block-root <block-id>` (repeatable; or the environment variable
  `BLOCH_REJECT_BLOCK_ROOTS`): a node-local option that makes the node drop
  a named block and all its descendants from its stored chain at start and
  never adopt them again. It changes no consensus rule. A node left on the
  abandoned branch of the 2026-11-12 stall rejoins the canonical chain, with
  its data directory kept, by starting once with:

  ```text
  --reject-block-root 13b2ab63d03a8045751ff05008a167063e049ae1f889f29aa415ac6d05974647
  ```

  A node that is on the canonical chain does not need this option.

**Upgrading.**

- This is an upgrade artifact for an existing Genesis-4 node. It does not
  include validator keys, passphrases, chain data or genesis material.
- Preserve the existing node arguments and the slashing-protection data. Stop
  the old process cleanly, replace only the executable, and keep the prior
  executable.
- The state cache is bound to the build, so **the first start replays the
  chain from genesis**. That takes about 70 minutes on a validator-class
  host. Validator duties then wait a 64-slot doppelganger window, about 32
  minutes. Plan for about 1 h 45 min without attestations, and finish well
  before the deadline.
- Upgrade validators that share a key set one at a time. Never run two
  processes with the same validator key.
- A node started with an empty data directory needs no checkpoint file: the
  release carries a finalized checkpoint (epoch 7306) and syncs from genesis
  under it.
- Rolling back to an earlier release is safe only before epoch 8620.
