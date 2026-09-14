# Start a Bloch validator — Genesis-4

Release: September 14, 2026. Linux x86_64. Admission is scheduled for epoch **2884**, September 14 at **22:35:19 UTC / 19:35:19 Brasília time**. The operator’s requested onboarding time is **23:00 UTC / 20:00 Brasília time**. Confirm `active: true` on your own synchronized node before submitting a deposit. The live status is displayed in the [validator guide](/validators/guide). Both public archivals confirmed active admission at 22:35:55 UTC and again at 22:36:28 UTC on September 14. [Deployment and test record](/releases/2026-09-14/onboarding-verification.json).

Deposits require at least **25,000 BLCH plus fees** in eligible native UTXOs. Registration must finalize; activation then waits at least **8 epochs (128 minutes)** and is limited to four new validators per epoch. Starting at 20:00 does not mean signing at 20:00.

The full mainnet exit → withdrawal → payout-spend qualification is still pending. Withdrawal has a 2,048-epoch delay (about 22.8 days). Protocol admission does not establish that this end-to-end qualification has completed. See [ADR-041](/docs/validator-exit-and-withdrawal.md).

## 1. Download and verify the node

Use Linux x86_64 with glibc 2.34 or newer (for example Ubuntu 22.04 or 24.04), persistent SSD storage and a synchronized clock. This executable is not a native macOS, Windows or Alpine/musl build. The earlier observer reference used 2+ vCPU, 8 GB RAM and 80 GB SSD; replay speed varies and a validator also needs resources for its duties. Check resource use during synchronization. Use a dedicated data directory and never duplicate an identity between running servers.

Prerequisites: `bash`, `curl`, `gzip`, `sha256sum`, `python3`. On Ubuntu, install missing packages through your normal package manager. Check `timedatectl status`.

Download the script, read it, then execute it. It downloads only public files and refuses an existing installation directory. It does not create a key, start a process or submit a transaction.

```sh
curl --fail --show-error --location \
  --output prepare-node.sh https://blochl1.com/downloads/prepare-node.sh
less prepare-node.sh
bash prepare-node.sh "$HOME/bloch-validator-20260914"
cd "$HOME/bloch-validator-20260914"
./bloch-pos --version
```

Direct downloads:

- [Linux x86_64 executable](/releases/2026-09-14/bloch-pos-linux-x86_64)
- [Genesis manifest](/releases/2026-09-14/mainnet.manifest)
- [Compressed carryover](/releases/2026-09-14/carryover.tsv.gz)
- [Corresponding build source](/releases/2026-09-14/bloch-pos-source.tar.gz)
- [Release metadata](/releases/2026-09-14/release.json) and [SHA-256 checksums](/releases/2026-09-14/SHA256SUMS.txt)

Binary SHA-256:

```text
b3171d1227333284d65c7f60ac925d9e49123908d4c5fcb124ede3f1568a1084
```

The preparation script pins the public checkpoint’s hashes, but trust in its signers must be checked independently. Compare the signer-set SHA3-256 fingerprint through another trusted channel:

```text
bccb7c5ee127f806ac7da69a6dfab0a0b1c3d2750d6224bbfb652baa3322d627
```

The epoch-1536 checkpoint expires for initial synchronization at epoch 3552, September 22 at 08:43:19 UTC. Obtain its renewal before that point. [Checkpoint details and downloads](/validators/guide#confianca).

## 2. Start as an observer and synchronize

```sh
./run-node.sh
```

With no `data/validator.key`, the process is a **keyless observer**. It downloads blocks from the public bootnodes and validates the full history against the signed checkpoint. Keep it running. The RPC can be busy or unavailable during replay. In another terminal:

```sh
curl --fail --show-error --max-time 30 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getchaininfo","params":[]}' \
  http://127.0.0.1:16400/
```

Wait until the head follows the network, `behind_by_slots` is 0–1, and finalized epochs advance. The observer test does not itself prove that a new funded validator has joined or withdrawn.

## 3. Prepare the identity with the human custodian offline

A production private key must never be generated in an AI-agent session, recorded/shared terminal or CI job. Review the [key custody requirements](/docs/validator-key-custody.md). Use a private offline Linux machine and transfer only public metadata to coordination systems.

An optional [interactive preparation helper](/downloads/prepare-identity.sh) is provided for the human custodian. It checks the pinned executable, requires a private interactive terminal, asks for a passphrase without echo, creates a sealed BPOSKEY2 auto-index keystore, and exports public metadata. **It invokes the existing `keygen` utility, which retains its devnet/throwaway label; the helper is not an independently qualified production custody ceremony.** Review that limitation and the code before use. Operators with an existing production identity should use their established ceremony instead and must not regenerate the identity.

Copy the verified Linux executable and reviewed helper to the offline machine. Run there manually, with actual absolute paths:

```sh
bash prepare-identity.sh /absolute/path/bloch-pos /absolute/path/new-validator-identity
```

The helper creates:

- `keystore/validator.key`: sealed validator key and RANDAO material; private.
- `validator.pass`: password; private, store separately from backups of the key.
- `validator.pub.hex`, `public.tsv`, `public.json`: public metadata.

Back up the sealed key, RANDAO material and password before moving the operational copy to your own server. Keep the **withdrawal spending key separate** from the validator. The funding owner also needs a supported suite-1 key and eligible spendable outputs; creating a validator key does not create funds.

## 4. Install the validator identity in the synchronized directory

Stop the observer with Ctrl-C and confirm the process has exited. Securely transfer the sealed validator key and password to your server using your own custody procedure. Do not upload them to the explorer. Then, from your installation directory, replace the example source paths:

```sh
install -m 600 /secure-transfer/validator.key data/validator.key
install -m 600 /secure-transfer/validator.pass validator.pass
export BLOCH_KEYSTORE_PASSPHRASE_FILE="$PWD/validator.pass"
./run-node.sh
```

Do not overwrite an existing key or slashing journal. Only one running instance may use the identity. The node can follow the chain while its key is unregistered or queued; eligibility is resolved from the registry without another restart. Duplicate-instance protection remains enabled.

For a persistent systemd service, use section 5 of the [operations guide](/validators/guide#servico), adapting its paths to this installation and provisioning the password file securely. Foreground operation stops if its terminal closes.

## 5. Check admission and funding

Download the submission helper on the server. Without `--submit`, it is read-only:

```sh
curl --fail --show-error --location --output deposit-submit.py \
  https://blochl1.com/downloads/deposit-submit.py
python3 deposit-submit.py
```

Confirm the network domain, `active: true`, minimum stake, current epoch and fee conditions. The explorer’s `/rpc` remains **read-only**. Use your own loopback RPC or an SSH tunnel to it for submission; no public shared submission password is required.

Funding inputs require the full 32-byte SHA3-256 hash of the suite-enveloped funding public key. Legacy 20-byte hashes padded to 32 bytes are not eligible directly. A legacy holder must first transfer coins to a native suite-1 output and verify inclusion and ownership. Obtain the correct transfer through the holder’s own wallet; the onboarding scripts do not convert or take custody of funds.

Use `listunspent` to identify eligible outputs controlled by the funding authority. Confirm their values and scripts. You need the funding public key, validator public key, RANDAO commitment from `public.json`, a withdrawal script whose spending key you control, a change script, and the selected funding inputs.

## 6. Prepare, inspect and sign the deposit offline

Follow the [funded-admission specification](/docs/funded-validator-admission.md). Replace every angle-bracket field below with independently verified values. They are not literal shell arguments. Use an expiry epoch that leaves time for both signatures and submission, and review the fee budget and commission.

```sh
./bloch-pos validator-deposit prepare \
  --genesis mainnet.manifest \
  --funding-pubkey funding.pub.hex --validator-pubkey validator.pub.hex \
  --randao <commitment-hex32> --withdrawal <withdrawal-script-hex32> \
  --change <change-script-hex32> --stake 2500000000000 \
  --input <txid-hex32>:<vout>:<value-sat> \
  --max-base-fee <millisat-per-gas> --tip <millisat-per-gas> \
  --expiry <inclusive-epoch> --commission <basis-points> --out draft.hex

./bloch-pos validator-deposit inspect --tx draft.hex
```

Each role signs on its custodian’s machine with the password supplied through `BLOCH_KEYSTORE_PASSPHRASE_FILE`. Switch that variable to the correct password file for each role. Check the genesis, funding inputs, stake, withdrawal credential, commission, expiry and fees before signing. Private keys remain with their owners.

```sh
./bloch-pos validator-deposit sign --genesis mainnet.manifest \
  --tx draft.hex --role funding --dir funding-keystore --out funded.hex
./bloch-pos validator-deposit inspect --tx funded.hex

./bloch-pos validator-deposit sign --genesis mainnet.manifest \
  --tx funded.hex --role validator --dir validator-keystore --out ready.hex
./bloch-pos validator-deposit inspect --tx ready.hex
```

The CLI refuses existing output files. Changing any intent field requires both signatures again. Return only the signed transaction to the online server.

## 7. Submit and track the new validator

On the synchronized server, after reviewing the signed transaction:

```sh
python3 deposit-submit.py --tx ready.hex --submit
```

**This command broadcasts the deposit and commits its funds if included.** It refuses the wrong network, inactive admission and non-deposit transaction tags. The node still performs consensus validation; a successful RPC submission is not finalization or activation.

Record the transaction ID returned by the node. Query `gettxstatus` with that ID and `getvalidatorbykey` with the `validator_pubkey_sha3_256` from `public.json`. For example, replace `YOUR_VALIDATOR_PUBLIC_KEY_HASH`:

```sh
curl --fail --show-error -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getvalidatorbykey","params":["YOUR_VALIDATOR_PUBLIC_KEY_HASH"]}' \
  http://127.0.0.1:16400/
```

Wait for registration finality and queued → active status. Keep the node synchronized. Attestation/proposal logs are useful operational evidence; verify inclusion on-chain. A queued key is not an active validator, and the default duplicate-instance observation window must also finish before signing.
