# Start a Bloch validator — Genesis-4

Guide updated September 17, 2026. Release: September 14, 2026. Linux x86_64. Admission was scheduled for epoch **2884**, September 14 at **22:35:19 UTC / 19:35:19 Brasília time**. Confirm `active: true` on your own synchronized node before submitting a deposit. The live status is displayed in the [validator guide](/validators/guide). Both public archivals confirmed active admission at 22:35:55 UTC and again at 22:36:28 UTC on September 14. [Deployment and test record](/releases/2026-09-14/onboarding-verification.json).

Deposits require at least **25,000 BLCH plus fees** in eligible native UTXOs. Registration must finalize; activation then waits at least **8 epochs (128 minutes)** and is limited to four new validators per epoch. Starting at 20:00 does not mean signing at 20:00.

The full mainnet exit → withdrawal → payout-spend qualification is still pending. Withdrawal has a 2,048-epoch delay (about 22.8 days), following the 32-epoch exit delay. Protocol admission does not establish that this end-to-end qualification has completed. See [ADR-041](/docs/validator-exit-and-withdrawal.md) and the [remaining qualification procedure](/docs/validator-qualification.md).

**Exchange observers:** follow only sections 1–2; no validator key or bond is required. The operator confirms the checkpoint ceremony occurred on September 4, 2026. The published record verifies signatures but does not independently attest the Phase-A signer identities or custody. See the [dated observer and admission status](/docs/observer-and-admission-status-2026-09-15.md) before relying on the checkpoint for deposit crediting.

**Checkpoint deadline:** the epoch-1536 checkpoint bundled with this release expires for initial synchronization at epoch 3552, **September 22, 2026 at 08:43:19 UTC**. After that instant, stop: obtain and independently verify the published renewal. Cryptographic signature acceptance does not override checkpoint age.

## Platform command map

**Ubuntu/Linux x86_64:** this is the only supported node platform for the published executable. Unless a block is explicitly labelled otherwise, every installation, identity, signing, systemd and monitoring command below runs in a Bash shell on Ubuntu Linux. The offline custody machine used with the public helper must also be Linux x86_64 and must use the verified release executable.

**macOS:** use Terminal only to connect to a supported Linux server or to stage public files before moving them to the offline Linux custodian. The published Linux executable does not run natively on macOS. Do not use commands from a private operator's Mac build as public release instructions.

```sh
# macOS Terminal — remote administration only
ssh -i "$HOME/.ssh/YOUR_SSH_KEY" ubuntu@YOUR_VALIDATOR_SERVER
scp -i "$HOME/.ssh/YOUR_SSH_KEY" PUBLIC_FILE \
  ubuntu@YOUR_VALIDATOR_SERVER:/home/ubuntu/

# macOS checksum command for a public staging file
shasum -a 256 PUBLIC_FILE
```

**Windows:** use Windows Terminal or PowerShell only as an SSH client to the supported Linux server. No native Windows validator executable is published for this release. WSL is not the documented production deployment target.

```powershell
# Windows PowerShell — remote administration only
ssh -i "$HOME\.ssh\YOUR_SSH_KEY" ubuntu@YOUR_VALIDATOR_SERVER
scp -i "$HOME\.ssh\YOUR_SSH_KEY" PUBLIC_FILE `
  ubuntu@YOUR_VALIDATOR_SERVER:/home/ubuntu/

# Windows checksum command for a public staging file
Get-FileHash -Algorithm SHA256 PUBLIC_FILE
```

SSH and SCP examples above are for public installation material or normal administration. Transfer validator keys and password files only through the operator's approved custody procedure; do not treat a generic copy command as the custody ceremony.

## 1. Download and verify the node

Use Linux x86_64 with glibc 2.34 or newer (for example Ubuntu 22.04 or 24.04), persistent SSD storage and a synchronized clock. This executable is not a native macOS, Windows or Alpine/musl build. The earlier observer reference used 2+ vCPU, 8 GB RAM and 80 GB SSD; replay speed varies and a validator also needs resources for its duties. Check resource use during synchronization. Use a dedicated data directory and never duplicate an identity between running servers.

Prerequisites: `bash`, `curl`, `gzip`, `sha256sum`, `python3`. On Ubuntu, install missing packages through your normal package manager. Check `timedatectl status`.

On a fresh **Ubuntu Linux validator server**, install these prerequisites and check the clock:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl gzip python3
uname -m
getconf GNU_LIBC_VERSION
timedatectl status
free -h
df -h
```

Expect `x86_64`, glibc 2.34 or newer, and a synchronized system clock before starting the node.

Download the script, read it, then execute it. It downloads only public files and refuses an existing installation directory. It does not create a key, start a process or submit a transaction.

```sh
curl --fail --show-error --location \
  --output prepare-node.sh https://blochl1.com/downloads/prepare-node.sh
printf '%s  %s\n' \
  8fb3088e52d267dc922a8a01469663ee2e5eee393385a3401e87aee96104a95b \
  prepare-node.sh | sha256sum --check
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

### Install the Bloch CLI in your PATH

The `bloch-pos` executable is both the node and the offline validator CLI. It is not the legacy `postern-wallet` command. There is no npm package or extra wallet installation required for the Linux node instructions above.

After completing section 1, install the verified executable for your Linux user:

```sh
mkdir -p "$HOME/.local/bin"
install -m 755 ./bloch-pos "$HOME/.local/bin/bloch-pos"
export PATH="$HOME/.local/bin:$PATH"
command -v bloch-pos
bloch-pos --version
bloch-pos selfcheck
bloch-pos validator-deposit
```

Add `export PATH="$HOME/.local/bin:$PATH"` once to your shell configuration if you want this command available in future terminals. The installer-generated `run-node.sh` deliberately uses its own pinned local executable; replacing a PATH command does not upgrade a running service.

The published prebuilt release is **Linux x86_64 only**. On macOS, Windows or ARM, use SSH to a supported Linux server for node operation. A Linux binary cannot run natively on a Mac. Offline signing requires a separately reviewed executable built for the custodian’s platform; do not substitute an unrelated wallet CLI or an unpinned build. The Mac commands used for an individual operator’s setup are not a public macOS release.

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

Wait until the head follows the network, `behind_by_slots` is 0–1, and finalized epochs advance. On September 14 at 23:11:43 UTC, a keyless process started with empty data reached slot 92360 with zero lag and matched the fleet’s block and state roots. It used the public checkpoint and both public bootnodes, and confirmed active admission before it was stopped. This run took more than an hour under bounded CPU resources; allow time for full replay. The observer test does not itself prove that a new funded validator has joined or withdrawn.

## 3. Prepare the identity with the human custodian offline

A production private key must never be generated in an AI-agent session, recorded/shared terminal or CI job. Review the [key custody requirements](/docs/validator-key-custody.md). Use a private offline Linux machine and transfer only public metadata to coordination systems.

An optional [interactive preparation helper](/downloads/prepare-identity.sh) is provided for the human custodian. It checks the pinned executable, requires a private interactive terminal, asks for a passphrase without echo, creates a sealed BPOSKEY2 auto-index keystore, and exports public metadata. **It invokes the existing `keygen` utility, which retains its devnet/throwaway label; the helper is not an independently qualified production custody ceremony.** Review that limitation and the code before use. Operators with an existing production identity should use their established ceremony instead and must not regenerate the identity.

Download and review the helper on a connected staging machine, then transfer the verified helper and release binary to the offline machine using clean media:

```sh
curl --fail --show-error --location \
  --output prepare-identity.sh https://blochl1.com/downloads/prepare-identity.sh
printf '%s  %s\n' \
  1d2128fd02ac2aa12074d7d20c9f54f97015449fee56ecf7e4cae4c333188390 \
  prepare-identity.sh | sha256sum --check
less prepare-identity.sh
```

Copy the verified Linux executable and reviewed helper to the **offline Linux x86_64 custody machine**.
The helper requires Bash, `sha256sum`, `stty` and Python 3. It disables shell
tracing and terminal echo while reading the passphrase and restores terminal
settings afterwards. Run there manually, with actual absolute paths:

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
test ! -e data/validator.key || { echo "Existing identity: stop and inspect."; exit 1; }
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
printf '%s  %s\n' \
  f1e7e0d4407103ae4a510075142f797981e0b34e20a7dd675033e301f88f6abb \
  deposit-submit.py | sha256sum --check
python3 deposit-submit.py
```

Confirm the network domain, `active: true`, minimum stake, current epoch and fee conditions. The explorer’s `/rpc` remains **read-only**. Use your own loopback RPC or an SSH tunnel to it for submission; no public shared submission password is required.

Funding inputs require the full 32-byte SHA3-256 hash of the suite-enveloped funding public key. Legacy 20-byte hashes padded to 32 bytes are not eligible directly. A legacy holder must first transfer coins to a native suite-1 output and verify inclusion and ownership. Obtain the correct transfer through the holder’s own wallet; the onboarding scripts do not convert or take custody of funds.

Use `listunspent` to identify eligible outputs controlled by the funding authority. Confirm their values and scripts. You need the funding public key, validator public key, RANDAO commitment from `public.json`, a withdrawal script whose spending key you control, a change script, and the selected funding inputs.

Read eligible outputs from your own synchronized node, replacing the placeholder with the full 32-byte native funding script hash (not a wallet password or private key):

```sh
curl --fail --show-error --max-time 30 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"listunspent","params":["YOUR_NATIVE_FUNDING_SCRIPT_HASH",100]}' \
  http://127.0.0.1:16400/
```

Verify each chosen outpoint with `gettxout` and its originating transaction with `gettxstatus`. Do not copy the founder’s outpoints, key hashes or transaction IDs from another operator’s example. If the response reaches its requested limit, do not assume it lists the wallet’s entire balance.

```sh
curl --fail --show-error --max-time 30 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"gettxout","params":["YOUR_TXID",YOUR_VOUT]}' \
  http://127.0.0.1:16400/

curl --fail --show-error --max-time 30 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"gettxstatus","params":["YOUR_TXID"]}' \
  http://127.0.0.1:16400/
```

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
export BLOCH_KEYSTORE_PASSPHRASE_FILE=/secure/path/funding.pass
./bloch-pos validator-deposit sign --genesis mainnet.manifest \
  --tx draft.hex --role funding --dir funding-keystore --out funded.hex
./bloch-pos validator-deposit inspect --tx funded.hex
unset BLOCH_KEYSTORE_PASSPHRASE_FILE

export BLOCH_KEYSTORE_PASSPHRASE_FILE=/secure/path/validator.pass
./bloch-pos validator-deposit sign --genesis mainnet.manifest \
  --tx funded.hex --role validator --dir validator-keystore --out ready.hex
./bloch-pos validator-deposit inspect --tx ready.hex
unset BLOCH_KEYSTORE_PASSPHRASE_FILE
```

The CLI refuses existing output files. Changing any intent field requires both signatures again. Return only the signed transaction to the online server.

## 7. Submit and track the new validator

On the synchronized server, after reviewing the signed transaction:

```sh
python3 deposit-submit.py --tx ready.hex --submit
```

**This command broadcasts the deposit and commits its funds if included.** It refuses the wrong network, inactive admission and non-deposit transaction tags. The node still performs consensus validation; a successful RPC submission is not finalization or activation.

Record the consensus transaction ID printed by `validator-deposit inspect`; a returned `tx_hash` may be only a local correlation handle. Query `gettxstatus` with that ID and `getvalidatorbykey` with the `validator_pubkey_sha3_256` from `public.json`. For example, replace `YOUR_VALIDATOR_PUBLIC_KEY_HASH`:

```sh
curl --fail --show-error -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getvalidatorbykey","params":["YOUR_VALIDATOR_PUBLIC_KEY_HASH"]}' \
  http://127.0.0.1:16400/
```

Wait for registration finality and queued → active status. Keep the node synchronized. Attestation/proposal logs are useful operational evidence; verify inclusion on-chain. A queued key is not an active validator, and the default duplicate-instance observation window must also finish before signing.

## 8. Keep the node running with systemd

Use a dedicated non-root Linux account. The following example assumes the verified installation is `/home/bloch/bloch-validator-20260914`, owned by user `bloch`. Replace both paths and the service user consistently if your account differs. Do not paste an example account or path that does not exist.

Complete observer synchronization before switching an already running observer to this service. Stop that foreground process cleanly. Install the validator key and password only through your custody procedure, as in section 4. Do not run the foreground launcher and the service at the same time.

Save this as `/etc/systemd/system/bloch-validator.service` with administrative privileges:

```ini
[Unit]
Description=Bloch Genesis-4 validator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bloch
WorkingDirectory=/home/bloch/bloch-validator-20260914
Environment=BLOCH_KEYSTORE_PASSPHRASE_FILE=/home/bloch/bloch-validator-20260914/validator.pass
UnsetEnvironment=BLOCH_NO_DOPPELGANGER BLOCH_KEYSTORE_ALLOW_PLAINTEXT
ExecStart=/home/bloch/bloch-validator-20260914/run-node.sh
Restart=on-failure
RestartSec=10
UMask=0077
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Then start and inspect it:

```sh
sudo systemd-analyze verify /etc/systemd/system/bloch-validator.service
sudo systemctl daemon-reload
sudo systemctl enable --now bloch-validator.service
systemctl status bloch-validator.service --no-pager
sudo journalctl -u bloch-validator.service -n 50 --no-pager
```

Keep the unit readable by systemd and the key/password readable only by the service account. Do not put a password directly into the unit, shell command, log or support message. This example enables restart after failure; an interrupted bootstrap before the checkpoint may need the recovery review described below rather than repeated restarts.

## 9. Follow the deposit and activation

Use the **consensus transaction ID printed by `validator-deposit inspect`**. A submission response may also contain `tx_hash`, explicitly labelled a local correlation handle; that value is not the consensus transaction ID.

```sh
curl --fail --show-error --max-time 30 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"gettxstatus","params":["YOUR_CONSENSUS_TRANSACTION_ID"]}' \
  http://127.0.0.1:16400/
```

Interpret the result together with `getvalidatorbykey`:

- `unknown`: this node has no status for the transaction. Check its identity, synchronization and the submission receipt before deciding whether to resubmit.
- `pending`: received in that node’s mempool; no registration is established yet.
- `included` or `justified`: the transaction is in the observed chain; continue checking finality and the registry.
- `finalized`: the node reports finalized inclusion. Compare matching checkpoints on another synchronized reference.
- Registry `state: queued`: the identity is registered but does not yet have active consensus duties.
- Registry `state: active`: eligible according to that node’s committed state. The process must also finish synchronization and duplicate-instance observation before signing.

The sentinel index `4294967295` in a newly generated key means automatic assignment; it is not the on-chain validator number. Find the assigned number with `getvalidatorbykey`. Do not edit the key to force an index, and do not assume the next public validator will receive index 64.

The minimum activation delay is eight epochs, about 128 minutes at 16 minutes per epoch; finality, queue limits and local readiness may extend the wait. The default duplicate-instance observation window is 64 slots, about 32 minutes. Neither elapsed time nor `active` alone proves an attestation was included. Verify actual duties against chain records.

For ongoing checks:

```sh
curl --fail --show-error --max-time 10 http://127.0.0.1:17400/health
curl --fail --show-error --max-time 10 http://127.0.0.1:17400/metrics
sudo journalctl -u bloch-validator.service --since '20 minutes ago' --no-pager
systemctl show bloch-validator.service \
  -p MainPID -p ActiveState -p NRestarts -p MemoryCurrent
```

A healthy process or `is_syncing: false` is not sufficient: inspect head slot, `behind_by_slots`, peer count and advancing finality. During fresh historical replay the head can be far behind despite a healthy process.

## 10. Troubleshooting

**`command not found` or `Exec format error`:** check PATH and executable permissions; verify the platform and checksum. The published Linux x86_64 binary needs glibc 2.34 or newer.

**Wallet password rejected:** first confirm the encrypted wallet file exists and its drive is mounted. Wallet access errors, unsupported formats and a different funding public key are distinct from an incorrect password. Do not post the password, wallet JSON, validator key or password file. Use a reviewed tool that reports the failure stage without printing secrets.

**`Possession signature present: true`, funding signature false:** validator authorization is complete, but the funding owner must still sign the same intent. The funding wallet and validator keystore are different roles. Do not regenerate the identity or change the draft to resolve this.

**A legacy wallet JSON does not work with `--dir`:** the deposit signer expects a supported node keystore directory, not a wallet JSON. Legacy conversion and funding authorization require a separately reviewed adapter for that wallet format. There is no generic conversion command in the public installation helper. Preserve the original withdrawal authority; never use a message signature or a Genesis-3 transfer as a substitute for a Genesis-4 transaction signature.

**No archival answered / HTML instead of JSON / timeout:** check the endpoint and local node first. RPC silence during startup replay can be expected. An explorer proxy error does not prove that block production stopped. Keep the node running, inspect its logs and compare references; do not repeat the deposit just because a website timed out.

**`ERR_WS_REQUIRE_CHECKPOINT`:** stage the signed envelope and correct signer set, then use the generated launcher. A bare checkpoint or an old genesis-only command is insufficient.

**`ERR_WS_STALE` after stopping a partially synchronized node:** this release may refuse a restart when its historical head is still before the supplied checkpoint. Do not disable checkpoint enforcement or delete a validator’s history. Stop the new instance and preserve its entire directory. Have the operator compare the reported roots and determine whether a fresh bootstrap is appropriate. Preserve the identity and every signing/slashing record; an existing signer must not be treated as a disposable observer. To avoid this interruption, let the observer finish synchronization before installing its identity, or provision the identity before its first start.

**`VALIDATOR_NOT_FOUND`:** check that the deposit was included, that the correct full public-key hash was used, and that the queried node is synchronized. Before inclusion this response is expected.

**Deposit expired or an input is spent:** inspect chain state and the receipt before retrying. If the intent must change, create a new draft and obtain both signatures again. Never alter a signed transaction in place.

**`Address already in use`, data lock or duplicate-instance warning:** stop the unintended duplicate. Each instance needs distinct data, ports and service name. Never disable duplicate-instance protection to make a second copy run.

## 11. Multiple validators, upgrades and withdrawals

A 32 GB machine does not have a guaranteed validator capacity. Measure available RAM, CPU, storage, swap and catch-up performance; leave headroom for replay. Each additional identity requires its own key, data directory, password file, service and three unused ports. The sample defaults are P2P 19000, RPC 16400 and metrics 17400. Keep RPC and metrics on loopback; outbound connections to the published peers are enough for this launcher. Do not expose a private submission RPC to the internet.

Before upgrading, read the coordinated release and activation epoch, verify the new artifact, preserve history and signing records, and stop the old process before starting the replacement. Never copy another validator’s key, RANDAO secret or slashing journal to create a new identity.

For an ordinary voluntary exit included at epoch E, this release uses `exit_epoch = E + 32` and `withdrawable_epoch = E + 32 + 2048`: 23 days, 2 hours and 40 minutes from the start of E, excluding the preceding activation period and subsequent inclusion/finality time. Slashing can extend the lock. Read the actual registry values and [withdrawal qualification procedure](/docs/validator-qualification.md). The complete mainnet withdrawal-and-spend qualification remains pending; this guide does not promise an immediate or independently qualified redemption path.

## 12. Dated operational evidence

The operator's September 15 expansion record documents a separate batch of 30 distinct identities. Thirty signed deposits were accepted and later observed included; registry records assigned indices 66 through 95 and reported them queued at the recorded observation. Each identity had a separate directory, service and port set. This is dated operator evidence, not a live status claim and not proof that another operator will obtain the same capacity or activation time.

The batch used purpose-built, pinned conversion and signing scripts tied to that operator's wallet and reviewed intents. Those private scripts are not a generic onboarding path and must not be copied by another validator. The transferable public procedure is the single-validator flow in sections 1–9 above.

## 13. Final handoff checklist

- The node follows the canonical head with 0–1 slot lag and advancing finality.
- The signed checkpoint and signer-set fingerprint were checked independently.
- The identity, RANDAO material and slashing journal have consistent backups; the password is stored separately.
- Funding inputs are native, unspent, finalized and controlled by the funding signer.
- Withdrawal and change credentials are controlled and independently recorded.
- Both roles inspected and signed the same deposit intent.
- The consensus transaction ID, deposit receipt and validator public-key hash are recorded.
- The registry is tracked through finalized registration, queued status and active status.
- RPC and metrics remain on loopback; alerts cover lag, finality, peers, disk, memory, restarts and duplicate-instance protection.
