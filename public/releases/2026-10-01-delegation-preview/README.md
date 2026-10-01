# Funded delegation binary — October 1 preview

**Signed Linux x86-64 preview. Full CLI/RPC qualification is still running. This is not a production rollout approval.**

- [Download the binary](https://blochl1.com/releases/2026-10-01-delegation-preview/bloch-pos)
- [GitHub prerelease and qualification updates](https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/releases/tag/funded-delegation-epoch-4528-preview)
- [Pinned source](https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/tree/c43dbd667295fb8314c22a156c6e696b9f5c88c0)
- [Validator guide](https://blochl1.com/validators/guide)

The binary schedules funded delegation at **epoch 4528, slot 144896**: **October 3, 2026 at 04:59:19.962 UTC**, or **01:59:19.962 in America/Sao_Paulo**. This is a slot/epoch boundary, not a predicted produced-block height. Installing this executable arms that fixed boundary; there is no runtime activation override.

Do not deploy this preview to mainnet before qualification and network upgrade coordination are complete. Old binaries reject activated transactions. A missed coordination window requires a newly qualified schedule and executable. Publication does not mean that any of the 95 inventoried production validators has been migrated.

## Verification

Use the previously trusted release public key. Download these seven files into a new directory:

```bash
base=https://blochl1.com/releases/2026-10-01-delegation-preview
for name in bloch-pos BUILD-INFO release.json README.md SHA256SUMS SHA256SUMS.minisig bloch-release-20260922.pub; do
  curl --fail --show-error --location "$base/$name" --output "$name" || exit 1
done
minisign -Vm SHA256SUMS -p bloch-release-20260922.pub || exit 1
sha256sum --check SHA256SUMS || exit 1
chmod 0755 bloch-pos
./bloch-pos --version
```

Expected source commit: `c43dbd667295fb8314c22a156c6e696b9f5c88c0`.
Expected binary SHA-256:

```text
bd58e25faab8ed3fb1ba67096f64e48ec65e8a66e248b3fda8c5d7a814c95a06
```

The signed checksum manifest covers the executable, build record, release metadata, this README and the public-key file. Verify key identity against your existing trusted copy; a key downloaded beside its signature is not an independent trust anchor.

## Qualification at publication

Two authenticated Linux builders independently produced byte-identical canonical-container artifacts. The exact executable replayed the finalized **108,474-block** mainnet prefix through slot **138751**, reproducing state root `aa599c8f7c30d1633a5c9412b499db2e0d8edc8559ec1c3b4df7a4c7d790b088`.

The finite-gate three-validator laboratory has finalized commission, funding, delegation activation and exit, and has rejected unauthorized signatures and premature withdrawal. Full mature payout and repeated-withdrawal rejection remain pending in the running 500 ms rehearsal. Earlier faster attempts failed due to finality lag or RPC timeouts and remain failed observations. See `release.json` for the timestamped publication snapshot and the GitHub release for later qualification updates.

The executable preserves the fixed **500,000,000 BLCH principal ceiling per validator**. The requested **5% commission** requires separate finalized operator transactions after activation; downloading this binary does not configure commissions or delegate funds.

An eventual coordinated upgrade must preserve service arguments, key environment, chain data, slashing protection and the normal 64-slot doppelganger observation. This package contains no validator keys, passphrases, chain data or bootstrap checkpoint. Historical replay is not a fresh-bootstrap or P2B internal-test confirmation.
