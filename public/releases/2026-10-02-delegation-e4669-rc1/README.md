# Funded delegation binary — epoch 4669 release candidate 1

**Signed Linux x86-64 release candidate. The full laboratory lifecycle and historical replay passed. Mainnet rollout remains blocked on coordinated network upgrade readiness.**

- [Download the binary](https://blochl1.com/releases/2026-10-02-delegation-e4669-rc1/bloch-pos)
- [GitHub prerelease and qualification updates](https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/releases/tag/funded-delegation-epoch-4669-rc1)
- [Pinned source](https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/tree/3a68f10bca501626dca54faab74a80a019057562)
- [Validator guide](https://blochl1.com/validators/guide)

The binary schedules funded delegation at **epoch 4669, slot 149408**: **October 4, 2026 at 18:35:19.962 UTC**, or **15:35:19.962 in America/Sao_Paulo**. This is a slot/epoch boundary, not a predicted produced-block height. Installing this executable arms that fixed boundary; there is no runtime activation override.

Do not deploy this release candidate to mainnet before network upgrade coordination is complete. Old binaries reject activated transactions. A missed coordination window requires a newly qualified schedule and executable. Publication does not mean that any of the 95 inventoried production validators has been migrated.

This candidate supersedes the epoch-4528 preview. The new date is the first epoch boundary at or after 72 hours from the operator's October 1 request (18:31:30.865140 UTC). The obsolete binary retains its old fixed activation date and must not be installed for this schedule. Its signed assets remain unchanged as historical evidence.

## Verification

Use the previously trusted release public key. Download these seven files into a new directory:

```bash
base=https://blochl1.com/releases/2026-10-02-delegation-e4669-rc1
for name in bloch-pos BUILD-INFO release.json README.md SHA256SUMS SHA256SUMS.minisig bloch-release-20260922.pub; do
  curl --fail --show-error --location "$base/$name" --output "$name" || exit 1
done
minisign -Vm SHA256SUMS -p bloch-release-20260922.pub || exit 1
sha256sum --check SHA256SUMS || exit 1
chmod 0755 bloch-pos
./bloch-pos --version
```

Expected source commit: `3a68f10bca501626dca54faab74a80a019057562`.
Expected binary SHA-256:

```text
22478fc5797ff673d390ed91b5b6a5120aa389b9bdbf798cf6b1abf99e60f7ba
```

The signed checksum manifest covers the executable, build record, release metadata, this README and the public-key file. Verify key identity against your existing trusted copy; a key downloaded beside its signature is not an independent trust anchor.

## Qualification at publication

Two authenticated Linux builders independently produced byte-identical canonical-container artifacts. The exact executable replayed the finalized **108,474-block** mainnet prefix through slot **138751**, reproducing state root `aa599c8f7c30d1633a5c9412b499db2e0d8edc8559ec1c3b4df7a4c7d790b088`.

The corrected epoch-8 laboratory completed the entire CLI/RPC lifecycle with three validators and an old observer at 100 ms slots. It retained the actual 32-epoch cooldown and 2,048-epoch withdrawal delay. Commission, funded activation, exit, exact mature payout accounting and a second-withdrawal refusal passed; all validators agreed on finalized checkpoints. The old observer refused activated transaction blocks. Forged signatures, premature withdrawal and a commission increase after funding were refused.

The candidate maintains the durable block-log fingerprint incrementally and indexes fork-choice parent/child and vote inputs. It avoids full-history cache hashing and parent/child rebuilding while retaining the exact historical vote order, current stakes and tie breaks. Restart recovery still independently verifies the stored prefix. A strict cache restart recovered all 108,474 historical blocks with zero tail blocks replayed and the same state root. The earlier 500 ms failure and the cache-only 50 ms and 100 ms finality-lag failures remain failed observations; this candidate does not qualify 50 ms operation. See `release.json` for the exact binary identities, timing, payout evidence and result scope.

This release candidate supersedes the epoch-4669 preview; old signed assets remain unchanged. Readiness of the 44 active validators outside the 95-validator inventory remains unresolved. No validator has been migrated by this qualification or publication workflow.

The executable preserves the fixed **500,000,000 BLCH principal ceiling per validator**. The requested **5% commission** requires separate finalized operator transactions after activation; downloading this binary does not configure commissions or delegate funds.

An eventual coordinated upgrade must preserve service arguments, key environment, chain data, slashing protection and the normal 64-slot doppelganger observation. This package contains no validator keys, passphrases, chain data or bootstrap checkpoint. Historical replay is not a fresh-bootstrap or P2B internal-test confirmation.
