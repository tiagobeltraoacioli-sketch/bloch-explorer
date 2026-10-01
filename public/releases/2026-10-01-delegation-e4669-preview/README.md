# Funded delegation binary — epoch 4669 preview

**Signed Linux x86-64 preview. Full CLI/RPC qualification is blocked by a failed finality-lag rehearsal. Do not deploy to mainnet.**

- [Download the binary](https://blochl1.com/releases/2026-10-01-delegation-e4669-preview/bloch-pos)
- [GitHub prerelease and qualification updates](https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/releases/tag/funded-delegation-epoch-4669-preview)
- [Pinned source](https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/tree/da136d418c9a44575893ec9d596ab60555bfc67e)
- [Validator guide](https://blochl1.com/validators/guide)

The binary schedules funded delegation at **epoch 4669, slot 149408**: **October 4, 2026 at 18:35:19.962 UTC**, or **15:35:19.962 in America/Sao_Paulo**. This is a slot/epoch boundary, not a predicted produced-block height. Installing this executable arms that fixed boundary; there is no runtime activation override.

Do not deploy this preview to mainnet before qualification and network upgrade coordination are complete. Old binaries reject activated transactions. A missed coordination window requires a newly qualified schedule and executable. Publication does not mean that any of the 95 inventoried production validators has been migrated.

This candidate supersedes the epoch-4528 preview. The new date is the first epoch boundary at or after 72 hours from the operator's October 1 request (18:31:30.865140 UTC). The obsolete binary retains its old fixed activation date and must not be installed for this schedule. Its signed assets remain unchanged as historical evidence. All 22 focused delegation tests passed, including rejection at the superseded activation epoch.

## Verification

Use the previously trusted release public key. Download these seven files into a new directory:

```bash
base=https://blochl1.com/releases/2026-10-01-delegation-e4669-preview
for name in bloch-pos BUILD-INFO release.json README.md SHA256SUMS SHA256SUMS.minisig bloch-release-20260922.pub; do
  curl --fail --show-error --location "$base/$name" --output "$name" || exit 1
done
minisign -Vm SHA256SUMS -p bloch-release-20260922.pub || exit 1
sha256sum --check SHA256SUMS || exit 1
chmod 0755 bloch-pos
./bloch-pos --version
```

Expected source commit: `da136d418c9a44575893ec9d596ab60555bfc67e`.
Expected binary SHA-256:

```text
44f46b76caf5a30cd6bd19e3d3d4954529ff2317ce9d283ae02915386a1006bf
```

The signed checksum manifest covers the executable, build record, release metadata, this README and the public-key file. Verify key identity against your existing trusted copy; a key downloaded beside its signature is not an independent trust anchor.

## Qualification at publication

Two authenticated Linux builders independently produced byte-identical canonical-container artifacts. The exact executable replayed the finalized **108,474-block** mainnet prefix through slot **138751**, reproducing state root `aa599c8f7c30d1633a5c9412b499db2e0d8edc8559ec1c3b4df7a4c7d790b088`.

The prior epoch-8, three-validator, 500 ms laboratory failed after 14,965.375 seconds with `finality lag exceeds rehearsal budget`, before mature payout. Earlier partial activation and exit observations do not constitute a complete lifecycle pass. Full mature payout and repeated-withdrawal rejection remain unqualified. This reschedule changes the mainnet activation boundary only; it does not repair that failure. See `release.json` for the exact failed laboratory report and binary identities. Readiness of the 44 active validators outside the 95-validator inventory also remains unresolved.

The executable preserves the fixed **500,000,000 BLCH principal ceiling per validator**. The requested **5% commission** requires separate finalized operator transactions after activation; downloading this binary does not configure commissions or delegate funds.

An eventual coordinated upgrade must preserve service arguments, key environment, chain data, slashing protection and the normal 64-slot doppelganger observation. This package contains no validator keys, passphrases, chain data or bootstrap checkpoint. Historical replay is not a fresh-bootstrap or P2B internal-test confirmation.
