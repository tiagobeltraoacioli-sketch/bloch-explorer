# Bloch PoS validator upgrade — 2026-11-12 (security hardening)

This directory contains the Linux x86-64 validator binary built from commit
`7f1c116e4e172d6d4e14261adc87d2f01b15ce61` in the canonical release container
(`deploy/pos-release/Dockerfile`, `scripts/build-pos-release-container.sh`).

Binary SHA-256:

```text
636b8e1e18b7de5b815db180887ed67847ec76549b30536c90093bdfc89cef8d
```

Verify the signed checksum before installing:

```bash
minisign -Vm SHA256SUMS -p bloch-release-20260922.pub
sha256sum --check SHA256SUMS
./bloch-pos --version
```

The expected version is:

```text
bloch-pos-node 0.1.0-mainnet (7f1c116e4e172d6d4e14261adc87d2f01b15ce61)+ws-release-anchor (Genesis-4, block version 0xb10c0005)
source-digest sha3-256:9d9551deba9403b0e33bae05f3b8b6f82efbaf2f44387c4f7765f62d0a37b81f (371 files, 10972152 bytes) commit-source:asserted tree:asserted-clean
```

**No consensus change.** This release keeps the network-upgrade schedule of
the October 29 release (`78d4921c`): HF1, HF2 and HF3 are active, and KES
enforcement stays at epoch **8620** (2026-11-17 16:11 UTC). Every activation
gate added by this release ships inert. A full replay of mainnet history with
this binary reproduces the canonical chain bit for bit (same head, same state
root). Nodes on the October 29 release and on this release follow the same
chain.

**Why upgrade.** This release carries security hardening from an internal
review of the node (networking, persistence, execution and consensus
handling). During the 2026-11-12 finality stall, nodes on the previous build pinned
their consensus thread recomputing state roots across repeated reorgs and
stopped answering RPC and attesting, while nodes on this release kept up.
All validators are encouraged to upgrade. Details of the reviewed issues will
be published once the network has upgraded.

**Upgrading.**

- This is an upgrade artifact for an existing synchronized Genesis-4 node. It
  does not include validator keys, passphrases, chain data, genesis material
  or a weak-subjectivity checkpoint.
- Preserve the existing node arguments and the slashing-protection data. Stop
  the old process cleanly, replace only the executable, and keep the prior
  executable for rollback.
- The state cache is bound to the build, so **the first start replays the
  chain from genesis**. That takes about 70 minutes on a validator-class host.
  Duties then wait a 64-slot doppelganger window, about 32 minutes. Plan for
  about 1 h 45 min without attestations.
- Upgrade validators that share a key set one at a time. Never run two
  processes with the same validator key.
- Rollback to the October 29 release is possible at any time: this release
  changes no consensus rule.
