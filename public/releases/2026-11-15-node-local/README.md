# Bloch PoS node — 2026-11-15 (node-local, recommended)

This directory contains the Linux x86-64 node binary built from commit
`0067547f1cd8f740fa1b814361526a80be178885` in the canonical release container
(`deploy/pos-release/Dockerfile`, `scripts/build-pos-release-container.sh`).

Binary SHA-256:

```text
2c9547c0f68e6f69587cd7ed1e97c3a912304fd23b453bf3eb646e65200755e3
```

Verify the signed checksum before installing:

```bash
minisign -Vm SHA256SUMS -p bloch-release-20260922.pub
sha256sum --check SHA256SUMS
./bloch-pos --version
```

The expected version is:

```text
bloch-pos-node 0.1.0-mainnet (0067547f1cd8f740fa1b814361526a80be178885)+ws-release-anchor (Genesis-4, block version 0xb10c0005)
source-digest sha3-256:6f425c2276e39b03a2a5cef6642913462c6fd80a0c1ce846fc1dacbffc53c8f4 (384 files, 11335653 bytes) commit-source:asserted tree:asserted-clean
```

**Node-local release. No hard fork, no new activation.** This release
changes no consensus rule, state root, fork choice or gossip validity rule.
A full replay of mainnet history reproduces the canonical chain bit for bit
(same head, same state root as `906336fd`). Nodes on this release and on
`906336fd` follow the same chain.

**Recommended for every node before KES keys are bound.** Upgrade at your
own pace; it is not tied to an epoch deadline. It must be running on your
node before the network binds KES keys (the bind is announced in advance on
the official Bloch channels).

This release carries the same epoch-8620 rules as the mandatory November 13
release (`906336fd`). A node must run `906336fd` or this release before
epoch 8620 (2026-11-17 16:11 UTC); running this release satisfies that
requirement.

**What is in this release.**

- **KES bind liveness.** The block proposer and the block admission path now
  decide KES signing against the state rolled to the block's epoch, so empty
  epochs around the KES bind and sibling heads after a stall cannot halt
  block production or admission. Admission work on lagging nodes is bounded
  and signature-checked first.
- **Security hardening** from the November 14 audit of the node and the L1
  modules (peer handshake limits, file handling, RPC input limits and
  related fixes).
- **Optional security hooks for monitoring, off by default:**
  - `getsecuritystatus` RPC (loopback only unless `--security-status-remote`);
  - `--security-events <path>`: JSON-lines security event log;
  - `--admin-socket <path>`: local socket for temporary, capped peer bans.
  With none of these flags set the node behaves exactly as without them.
- **Dependencies:** `libp2p-gossipsub` 0.49.5, `tokio` 1.53.3, `rustix`
  1.1.6. Online `cargo audit`, `cargo deny` and `osv-scanner` pass with
  dated, justified exceptions (see `SECURITY_TOOLING.md` in the source).

**Qualification.** Canonical container build; 4,451 tests passed, 0 failed;
full mainnet history replay identical to `906336fd`; no gate armed.

**Upgrade.** Replace the binary and restart the unit; keep the data
directory and all flags unchanged. No new flag is required.
