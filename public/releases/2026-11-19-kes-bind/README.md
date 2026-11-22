# Bloch PoS node — 2026-11-19 (node-local, the release for the KES bind)

This directory contains the Linux x86-64 node binary built from commit
`4cd9b887b2a2a171b26b55da5c53d08c427def1a` in the canonical release container
(`deploy/pos-release/Dockerfile`, `scripts/build-pos-release-container.sh`).

Binary SHA-256:

```text
7d453d4f8d739cdb297a16dc4e34ece976d3a234df8ed6f44215cf2ead6db3a4
```

Verify the signed checksum before installing:

```bash
minisign -Vm SHA256SUMS -p bloch-release-20260922.pub
sha256sum --check SHA256SUMS
./bloch-pos --version
```

The expected version is:

```text
bloch-pos-node 0.1.0-mainnet (4cd9b887b2a2a171b26b55da5c53d08c427def1a)+ws-release-anchor (Genesis-4, block version 0xb10c0005)
source-digest sha3-256:28b7bbc78bf8db1b4d8e3cb84b004564d8b05424a33d1c5238b700845aad09b8 (388 files, 11706702 bytes) commit-source:asserted tree:asserted-clean
```

**Node-local release. No hard fork, no new activation.** This release changes
no consensus rule that is in force. A full replay of mainnet history (236,776
blocks, head slot 280239, epoch 8757) reproduces the canonical chain bit for
bit: same head and same state root as `0067547f`
(`39d9dc7ea4bb35f3ef915418869faa6e51f9100e6692979928a0c179a0ee9bf7`). Nodes on
this release and on `0067547f` follow the same chain. Qualification ran 4,515
tests with no failure.

**Recommended for every node before KES keys are bound.** Upgrade at your own
pace; it is not tied to an epoch. A validator that has registered a KES key
must have loaded it (the node reads it at start) before the network binds.

**What is in this release.**

- **Block admission around the KES bind.** A node that no longer holds the
  state of a side-branch parent recomputes it on demand, within fixed bounds,
  and a block waiting for that state is judged once. This removes a stall that
  needed a restart to clear. The change was reviewed independently of its
  author; it accepts and rejects the same blocks as `0067547f`.
- **Finality proofs.** `getlcproof` and `bloch-finality-verify` refuse a stale
  proof of KES state (review items CRY-2, FC-5). Until the bind, proofs are
  served in the format `BLCLMP02`; build `bloch-finality-verify` from this
  commit.
- **Secure mesh channel.** With the flags the fleet uses today
  (`--mesh-security offer`) the wire behaviour is unchanged and interoperates
  with `0067547f` in both directions. New, off by default: a per-address
  exception list for the `require` mode and counters of plaintext sessions.
- **Layer-2 handlers.** Faults in the pre-validation of layer-2 transactions
  are contained in the mempool and proposer paths.
- **Offline signing tools** sign over the root consensus verifies.
- **Release checkpoint.** The baked weak-subjectivity checkpoint is epoch 8742
  (block `7f13dd9b095e0574c67703feae3da23f0e55ea3127e6a51e725a5eaaf7e627ff`).
  Fresh installs accept it until epoch 10758 (2026-12-11 10:19 UTC). The
  checkpoint of the previous release expires for fresh installs on 2026-11-25.
- **Two inert gates** are added and not armed:
  `FUNDED_DELEGATION_GROWTH_CAP_ACTIVATION_EPOCH` and
  `L2_FAULT_ISOLATION_ACTIVATION_EPOCH`.
- **Dependencies:** `libz-sys` 1.1.33, `zstd-sys` 2.1.2, `rustls` 0.23.46,
  `rustls-webpki` 0.103.16, `webpki-roots` 1.0.10, `quinn-proto` 0.11.19,
  `quinn-udp` 0.5.16. None is on a consensus path; the node's dependency graph
  is unchanged.

**Known open items.** Two availability findings in side-branch handling (one
medium, one low) remain open; a restart of the affected node recovers it. No
third-party audit has been completed.
