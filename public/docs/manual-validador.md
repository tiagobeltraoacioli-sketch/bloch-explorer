# How to run a Bloch validator

Reviewed on September 14, 2026.

[Complete onboarding instructions and release downloads](/docs/validator-onboarding.md).

## 1. What this guide covers

Operational guide for Bloch Genesis-4, reviewed on September 14, 2026. An observer verifies the chain without signing. A validator also needs its own registered, eligible key on the chain. Installing the executable does not create a validator slot or a deposit.

The fleet check at 21:01 UTC on September 14 confirmed 64 processes running the same binary, all within 0–1 slot of the network clock and with attestations logged. At that point, 44 had completed qualification and 20 were still under observation. This is a historical record, not a live availability indicator.

The binary schedules recovery at epoch 2880 (September 14, 2026, 21:31:19 UTC) and the admission/exit lifecycle at epoch 2884 (22:35:19 UTC). Check your node’s current state: a scheduled time does not prove activation occurred. Broad admission of new participants still requires operational qualification of the complete exit, withdrawal and subsequent spending cycle. This guide does not announce that opening.

## 2. Prepare the server and files

Use Linux x86_64 for the artifact identified below, persistent SSD storage, a synchronized clock and administrative access. The reference fleet uses seven 32 GB servers for 64 processes; this is neither a minimum requirement nor a guarantee for another machine. Size CPU, RAM and disk for replaying the complete history and monitor memory during synchronization.

Download this release’s executable, mainnet.manifest and carryover.tsv.gz from /releases/2026-09-14/. The preparation script verifies their hashes and decompresses carryover.tsv. The complete onboarding instructions and download links appear above; section 3 covers the signed checkpoint. Do not substitute an arbitrary build of main or an old tag.

```text
Commit: 58da5ce209acb6e293b3b381dfd826dedb8741fd
Linux x86_64 · rustc 1.94.1
SHA-256 bloch-pos:
b3171d1227333284d65c7f60ac925d9e49123908d4c5fcb124ede3f1568a1084
SHA-256 mainnet.manifest:
7eef82a70ef9b0e1dd86f86d33cba11fc10cdfc7395c2e5f6669613fa1beb2dd
SHA-256 carryover.tsv:
84ddbbac2afdd5c78618096a7d4f66cf5b04a3e5757a03fe90550e50096183f6
```

Run the following Linux commands in the directory containing the three received files. Compare the complete hashes. A hash identifies bytes; it is not, by itself, a software audit.

```text
sha256sum bloch-pos mainnet.manifest carryover.tsv
chmod 755 bloch-pos
./bloch-pos --version
./bloch-pos selfcheck
timedatectl status
free -h
df -h
```

## 3. Choose a trusted source of history

New machine: the initial genesis trust window has ended. The original epoch 1536 envelope and its signer set are published at /checkpoints/epoch-1536/. On September 14, 2026, this release’s binary verified three valid hybrid signatures from three distinct keys. The set requires 2 of 3 signatures and at least one external signer; all three are declared external. That declaration alone does not establish personal identity or independence.

Both public RPCs agreed on checkpoint block d5b3a12207af3010a611b737be15877db476ce9629520e08c552b8995bf23d32 and state 84cceba212f6443cc5d9fd67ce578a3ae0f34cba5e5877d8082748b282db0780. The original signatures and bytes have been preserved. This verification does not replace a complete synchronization test from an empty machine. The validator_set_root field is the zero placeholder emitted and accepted by this release.

Deadline: at epoch 2878, the checkpoint was 1342 epochs old within the 2016-epoch window. It is accepted but already carries a STALE warning and needs renewal. Starting at epoch 3552, on September 22, 2026 at 08:43:19 UTC (05:43:19 Brasília time), it no longer authorizes initial synchronization. Check the current epoch; ACCEPTED from the cryptographic verifier does not override an EXPIRED age warning.

Download the files below and verify the WS digest and signer-set fingerprints through another independent trusted channel. Hashes downloaded from the same site only detect changes to bytes; they do not establish trust in the signers. verification.json records the result, fingerprints and verification limits.

```text
Original signed WS digest:
e329e6c61ccf91e9338d94a1c1c98e4984e92ad770e995b4ce44596edae2b801
```

```text
mkdir -p checkpoint-1536
cd checkpoint-1536
for file in ws-envelope.bin signer-set.bin checkpoint.bin checkpoint.json verification.json SHA256SUMS.txt; do
  curl --fail --show-error --location --output "$file" "https://blochl1.com/checkpoints/epoch-1536/$file" || exit 1
done
sha256sum --check SHA256SUMS.txt
cd ..
./bloch-pos ws-verify --envelope checkpoint-1536/ws-envelope.bin --signer-set checkpoint-1536/signer-set.bin --genesis mainnet.manifest --rpc 139.180.166.5:8080
```

Copying a block hash, a ws_latest.bin file or a third-party snapshot is not equivalent to obtaining a signed checkpoint. Do not create your own signer set to bypass verification. The node still replays the complete history from genesis: the envelope supplies a trust anchor, not a snapshot that removes the need for replay.

Existing operator: preserve your data directory, history, metadata, key and slashing_protection.bin. Use the canonical history already validated by your own node. Do not replace a newer local anchor with epoch 1536 or delete the signing record to make a restart succeed.

## 4. Prepare the validator identity

For production, generate and back up the identity and RANDAO material in an offline human ceremony using verified tools. The node’s keygen command is documented as a devnet tool; do not treat it as a production ceremony. Never send a private key, seed or password to a website, chat, support service or RPC.

A new identity uses the automatic index (sentinel 4294967295, usually represented by --index auto during key preparation). The final index comes from the on-chain registry. Do not choose an unused index yourself or modify sealed key bytes to change its index. An existing identity must retain its index and key.

The validation key must use the sealed BPOSKEY2 format. The password file must have permissions 0600 and its containing directory 0700. Keep the withdrawal authority and its backup separate from the validation key. Never run two instances with the same identity.

```text
# Node stopped; only for an existing legacy BPOSKEY1 key:
./bloch-pos keys seal --dir /var/lib/bloch/validator \
  --passphrase-file /etc/bloch/validator.pass

# Inspect the identity while the node is stopped:
./bloch-pos keys inspect --dir /var/lib/bloch/validator
```

keys seal converts a legacy key in place; running it again on an already sealed key is neither necessary nor appropriate. Do not enable BLOCH_NO_DOPPELGANGER or BLOCH_KEYSTORE_ALLOW_PLAINTEXT in the production service.

## 5. Install a Linux service

The example uses one validator per directory and the bloch service user. Existing operators should adapt paths to their preserved directory without overwriting it. For a new installation, proceed only after resolving the checkpoint and preparing the identity. The operator must provision the password without exposing it in arguments or shell history.

```text
sudo useradd --system --home /var/lib/bloch --shell /usr/sbin/nologin bloch
sudo install -d -o bloch -g bloch -m 700 /var/lib/bloch/validator
sudo install -d -o bloch -g bloch -m 700 /etc/bloch
sudo install -m 755 bloch-pos /usr/local/bin/bloch-pos
sudo install -m 644 mainnet.manifest /var/lib/bloch/mainnet.manifest
sudo install -m 644 carryover.tsv /var/lib/bloch/carryover.tsv
```

Do not repeat useradd if the user already exists. Place validator.key in /var/lib/bloch/validator and the password in /etc/bloch/validator.pass, both owned by bloch with permissions 0600. When migrating an existing identity, also transfer its history and signing record, only after stopping and disabling the old instance.

Write the unit below to /etc/systemd/system/bloch-validator.service. The devnet transport is the transport used by this Genesis-4 fleet; its name does not select a test network. The example allows outbound connections to both bootnodes and keeps RPC, metrics and the P2P listening port local.

```text
[Unit]
Description=Bloch Genesis-4 validator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bloch
Group=bloch
WorkingDirectory=/var/lib/bloch
Environment=BLOCH_KEYSTORE_PASSPHRASE_FILE=/etc/bloch/validator.pass
UnsetEnvironment=BLOCH_NO_DOPPELGANGER BLOCH_KEYSTORE_ALLOW_PLAINTEXT
ExecStart=/usr/local/bin/bloch-pos run --data-dir /var/lib/bloch/validator --genesis /var/lib/bloch/mainnet.manifest --carryover /var/lib/bloch/carryover.tsv --transport devnet --listen 19000 --listen-addr 127.0.0.1 --peers 139.180.166.5:19100,139.180.173.231:19100 --rpc-bind 127.0.0.1 --rpc-port 16400 --metrics-bind 127.0.0.1 --metrics-port 17400
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
UMask=0077

[Install]
WantedBy=multi-user.target
```

```text
sudo install -m 644 checkpoint-1536/ws-envelope.bin /var/lib/bloch/checkpoint.envelope.bin
sudo install -m 644 checkpoint-1536/signer-set.bin /var/lib/bloch/signer-set.bin
```

This ExecStart assumes your own history is already trusted. On a new node with valid trust files, append to the same ExecStart line: --ws-checkpoint /var/lib/bloch/checkpoint.envelope.bin --ws-signer-set /var/lib/bloch/signer-set.bin. Both files are public and must be readable by the bloch user. Never use an incomplete command containing ellipses in the service.

```text
sudo systemd-analyze verify /etc/systemd/system/bloch-validator.service
sudo systemctl daemon-reload
sudo systemctl enable --now bloch-validator.service
sudo systemctl status bloch-validator.service
sudo journalctl -u bloch-validator.service -f
```

The RPC does not provide authentication itself. Keep it on loopback; for remote access, use an SSH tunnel or an authenticated proxy in your infrastructure. Do not expose ports 16400 or 17400 to the internet. If you need inbound external P2P connections, explicitly plan the interface and firewall separately from the RPC.

## 6. Register a new identity once admission is open

Skip this section for an already registered identity. A running, synchronized server does not prove registration. Query getvalidatoradmission on your node and confirm active: true, the network domain, minimum stake, fee and queue limits. Review the pending withdrawal-cycle qualification before committing funds; protocol activation does not establish that qualification.

```text
curl --fail-with-body -sS http://127.0.0.1:16400/ \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getvalidatoradmission","params":[]}'
```

Funded admission consumes real UTXOs from a funding authority with a suite-1 hybrid key. This version defines a minimum of 25,000 BLCH (2,500,000,000,000 sat), subject to RPC verification and inclusion rules. A legacy balance does not guarantee that its outputs have the required format. Query listunspent and verify ownership, values and scripts.

Prepare the deposit offline and sign the funding and validation roles separately. Values in <...> below are fields to replace and verify; do not copy the transaction as if it were ready to submit. The withdrawal credential must correspond to a spending key you control.

```text
bloch-pos validator-deposit prepare \
  --genesis mainnet.manifest \
  --funding-pubkey funding.pub.hex --validator-pubkey validator.pub.hex \
  --randao <commitment-hex32> --withdrawal <withdrawal-script-hex32> \
  --change <change-script-hex32> --stake 2500000000000 \
  --input <txid-hex32>:<vout>:<value-sat> \
  --max-base-fee <millisat-per-gas> --tip <millisat-per-gas> \
  --expiry <inclusive-epoch> --commission <basis-points> --out draft.hex

bloch-pos validator-deposit inspect --tx draft.hex
bloch-pos validator-deposit sign --genesis mainnet.manifest \
  --tx draft.hex --role funding --dir funding-keystore --out funded.hex
bloch-pos validator-deposit inspect --tx funded.hex
bloch-pos validator-deposit sign --genesis mainnet.manifest \
  --tx funded.hex --role validator --dir validator-keystore --out ready.hex
bloch-pos validator-deposit inspect --tx ready.hex
```

Each signature uses its own key’s password through BLOCH_KEYSTORE_PASSPHRASE_FILE, without a password argument. Review the network, UTXOs, withdrawal credential, commission, fee and expiry on each machine. The CLI does not broadcast. Only after protocol admission is active and your review is complete, send the hexadecimal contents of ready.hex using sendrawtransaction to your own node or an authenticated endpoint. This explorer’s /rpc is read-only and does not broadcast deposits.

Track gettxstatus using the transaction ID and getvalidatorbykey using the public key’s SHA3-256 hash. Activation requires finalized registration, at least eight epochs (128 minutes), and respects the limit of four new validators per epoch. The wait may be longer; do not infer activation from elapsed time.

## 7. Confirm synchronization and participation

```text
curl --fail-with-body -sS http://127.0.0.1:16400/ \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getchaininfo","params":[]}'
curl --fail-with-body -sS http://127.0.0.1:17400/metrics
sudo journalctl -u bloch-validator.service --since '30 minutes ago'
```

Wait for replay to finish and the RPC to respond. behind_by_slots at 0–1 indicates that the node is following the head at that moment. Also check that height and finalized epoch advance. Compare the same block and checkpoint across references; similar heights alone do not prove the chain is the same.

The default observation window for duplicate instances is 64 slots after replay, approximately 32 minutes. A registered, eligible identity starts its duties after this window. Look for attested and proposing block in the logs. Not every slot is a duty for your validator; a proposal may take time to occur.

For the fleet migration, qualification requires following the canonical chain and advancing three finalized epochs after the first attestation. The example service does not automatically install the fleet’s private monitor: implement your own alerts and confirm that duties are included on-chain. A signing log alone does not prove inclusion.

Monitor memory, free space, peers, lag, finalization, restarts and protection messages. Also consult /validators and /validators/queues in this explorer. A website proxy failure does not prove the chain has stopped; check your local RPC.

## 8. Upgrade or migrate without duplicating the identity

Before changing releases, verify the hashes, network, activation epochs and compatibility with your history. Stop the service and confirm the process has ended before moving data or inspecting the key. Make a consistent backup of the stopped directory, including validator.key, slashing_protection.bin, blocks.log, meta.bin and ws_latest.bin, with the password stored separately.

```text
sudo systemctl stop bloch-validator.service
sudo systemctl show bloch-validator.service -p MainPID -p ActiveState
# MainPID must be 0 before replacement or transfer.
# Verify the new release and make a consistent backup before installing.
sudo install -m 755 /path/to/verified-release/bloch-pos /usr/local/bin/bloch-pos
sudo systemctl start bloch-validator.service
sudo journalctl -u bloch-validator.service -f
```

When changing servers, disable the old instance and prevent it from starting before activating the new one. Preserve the key, RANDAO seed and most recent signing record together. An old journal backup may permit conflicting signatures: do not restore it as a shortcut. Do not run two copies, even for a few seconds.

If the node follows another branch, stops due to protection or loses its journal, keep signing stopped and investigate. Do not delete metadata, reduce the observation window or use an old binary to force resumption. Reverting a version after a consensus change requires specific analysis.

## 9. Exit and withdrawal

After lifecycle activation, an exit is authenticated by the validator key. Query the current epoch and registry before signing. The exit’s inclusion epoch must match the signed epoch; an expired transaction must be recreated. The following tools generate files offline and do not broadcast.

```text
bloch-pos validator-lifecycle exit --dir validator-keystore \
  --epoch <inclusion-epoch> --out exit.hex

bloch-pos validator-lifecycle withdraw --validator <assigned-index> \
  --out withdraw.hex
```

Exit does not release funds immediately. In this version, the exit delay is 32 epochs and the withdrawal delay is 2,048 epochs; check eligibility in the registry. Withdrawal pays the registered credential, not an address chosen at withdrawal time. Penalties and whether the principal was funded affect the redeemable amount. Preserve the credential’s spending authority to use the received output.

## 10. Quick troubleshooting and references

RPC refused during replay: monitor journalctl and wait for initialization. Key refused: check the sealed format, ownership and password-file permissions. Identity ineligible: query getvalidatorbykey and the queue. Persistent lag: check the clock, peers, CPU, disk and checkpoint. Duplicate-instance alert: stop signing and locate the other instance before restarting.

This guide covers operation and preparation. A new participant still needs the trust artifacts and admission to be effectively open. The attached technical documents are references for the reviewed version and do not guarantee immediate entry. Renew the published checkpoint before the deadline in section 3.

## Checkpoint renewal

[Commands to extract, sign and publish the next checkpoint](/docs/renovar-checkpoint.md).
