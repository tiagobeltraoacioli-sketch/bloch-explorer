# Bloch L1 distribution — September 30, 2026

This distribution reuses the **exact signed Linux x86_64 executable released on
September 24, 2026**, from source commit
`4d4c5075872c622fdd26aa418a9d249ec95fbcea`. There is no new binary build, protocol
change or release signature. Bootstrap instructions now reference the existing
external epoch-3328 checkpoint; checkpoint bytes are not embedded in the binary.

- [Validator and observer guide](https://blochl1.com/validators/guide)
- [Preparation script](https://blochl1.com/downloads/prepare-node.sh)
- [Checkpoint verification](https://blochl1.com/checkpoints/epoch-3328/verification.json)
- [Checkpoint publication decision](https://blochl1.com/checkpoints/epoch-3328/PUBLICATION-DECISION-20260930.json)
- [Original binary release](https://blochl1.com/releases/2026-09-24/README.md)

## Verify the executable

Authenticate the existing `bloch-release-20260922.pub` key against a previously
trusted copy or an independent trusted channel. Download into a new directory:

```sh
base=https://blochl1.com/releases/2026-09-30
for name in bloch-pos SHA256SUMS SHA256SUMS.minisig bloch-release-20260922.pub BUILD-INFO release.json; do
  curl --fail --show-error --location "$base/$name" --output "$name" || exit 1
done
minisign -Vm SHA256SUMS -p bloch-release-20260922.pub || exit 1
sha256sum --check SHA256SUMS || exit 1
chmod 0755 bloch-pos
./bloch-pos --version
```

Expected SHA-256:

```text
fb8a65cbd9721d794bd4c2151b50d82d85a7df2299d59d7bad44a7635c30b46a
```

The executable must identify source commit `4d4c5075872c622fdd26aa418a9d249ec95fbcea`,
Genesis-4 and block version `0xb10c0005`. Its size is 8,710,816 bytes. Retained
outputs from the two September Linux builders have matching bytes and build
metadata; those historical outputs were compared again for this distribution.
No new Linux build or remote execution was performed for this redistribution.

The **original** Minisign signature authenticates `SHA256SUMS`. Its single
entry authenticates the unchanged `bloch-pos` executable only. The signature
does not cover this README, `release.json`, `BUILD-INFO`, the preparation script
or checkpoint files. `BUILD-INFO` is preserved unchanged as the historical
September 24 build record, including its historical authorization fields.
Do not interpret it as a signature or independent approval of new metadata.

## External checkpoint and operating limits

Epoch 3328 has three valid historical signatures, but all three secret keys
were used on the same Mac. **Independent custody is not verified**
(`independent_custody_verified: false`). The operator authorized using and
publishing the existing checkpoint on September 30; this decision does not
establish independent signing or exchange production readiness. Review its
separate verification and publication-decision records and independently
confirm the checkpoint digest and signer-set fingerprint before trusting it.

The checkpoint expires for initial synchronization at epoch **5344**, on
**October 12, 2026 at 06:35:19.962 UTC**. The preparation script requires a fresh
checkpoint and checks the host clock; cryptographic signature acceptance alone
does not establish freshness. A complete mainnet replay from an empty data
directory has not been repeated for this distribution.

Follow the guide for observer preparation or an existing validator upgrade.
Preserve existing chain data, service arguments and slashing-protection records.
Use the checkpoint, signer set and independently authenticated signer-set pin
together. Keep doppelganger protection enabled and run only one process for each
validator identity. The downloadable release includes no operational keys or
chain database. Publication does not prove that validators installed it or that
P2B approved a custody, deposit or withdrawal integration.
