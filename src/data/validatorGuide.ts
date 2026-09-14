// SPDX-License-Identifier: AGPL-3.0-or-later
export const validatorGuide = {
  "title": "How to run a Bloch validator",
  "updated": "September 14, 2026",
  "sections": [
    {
      "id": "escopo",
      "title": "1. What this guide covers",
      "blocks": [
        {
          "kind": "p",
          "text": "Operational guide for Bloch Genesis-4, reviewed on September 14, 2026. An observer verifies the chain without signing. A validator also needs its own registered, eligible key on the chain. Installing the executable does not create a validator slot or a deposit."
        },
        {
          "kind": "p",
          "text": "The fleet check at 21:01 UTC on September 14 confirmed 64 processes running the same binary, all within 0–1 slot of the network clock and with attestations logged. At that point, 44 had completed qualification and 20 were still under observation. This is a historical record, not a live availability indicator."
        },
        {
          "kind": "p",
          "text": "The installed binary schedules recovery at epoch 2880 (September 14, 2026, 21:31:19 UTC) and the admission/exit lifecycle at epoch 2884 (22:35:19 UTC). Technical onboarding instructions and verified downloads are available above. Confirm getvalidatoradmission.active on your own synchronized node before submitting. Full mainnet qualification of the exit, withdrawal and subsequent payout-spending cycle remains pending; an active admission flag does not establish that this qualification has completed."
        }
      ]
    },
    {
      "id": "requisitos",
      "title": "2. Prepare the server and files",
      "blocks": [
        {
          "kind": "p",
          "text": "Use Linux x86_64 for the artifact identified below, persistent SSD storage, a synchronized clock and administrative access. The reference fleet uses seven 32 GB servers for 64 processes; this is neither a minimum requirement nor a guarantee for another machine. Size CPU, RAM and disk for replaying the complete history and monitor memory during synchronization."
        },
        {
          "kind": "p",
          "text": "Download this release’s executable, mainnet.manifest and carryover.tsv.gz from /releases/2026-09-14/. The preparation script verifies their hashes and decompresses carryover.tsv. The complete onboarding instructions and download links appear above; section 3 covers the signed checkpoint. Do not substitute an arbitrary build of main or an old tag."
        },
        {
          "kind": "code",
          "text": "Commit: 58da5ce209acb6e293b3b381dfd826dedb8741fd\nLinux x86_64 · rustc 1.94.1\nSHA-256 bloch-pos:\nb3171d1227333284d65c7f60ac925d9e49123908d4c5fcb124ede3f1568a1084\nSHA-256 mainnet.manifest:\n7eef82a70ef9b0e1dd86f86d33cba11fc10cdfc7395c2e5f6669613fa1beb2dd\nSHA-256 carryover.tsv:\n84ddbbac2afdd5c78618096a7d4f66cf5b04a3e5757a03fe90550e50096183f6"
        },
        {
          "kind": "p",
          "text": "Run the following Linux commands in the directory containing the three received files. Compare the complete hashes. A hash identifies bytes; it is not, by itself, a software audit."
        },
        {
          "kind": "code",
          "text": "sha256sum bloch-pos mainnet.manifest carryover.tsv\nchmod 755 bloch-pos\n./bloch-pos --version\n./bloch-pos selfcheck\ntimedatectl status\nfree -h\ndf -h"
        }
      ]
    },
    {
      "id": "confianca",
      "title": "3. Choose a trusted source of history",
      "blocks": [
        {
          "kind": "p",
          "text": "New machine: the initial genesis trust window has ended. The original epoch 1536 envelope and its signer set are published at /checkpoints/epoch-1536/. On September 14, 2026, this release’s binary verified three valid hybrid signatures from three distinct keys. The set requires 2 of 3 signatures and at least one external signer; all three are declared external. That declaration alone does not establish personal identity or independence."
        },
        {
          "kind": "p",
          "text": "Both public RPCs agreed on checkpoint block d5b3a12207af3010a611b737be15877db476ce9629520e08c552b8995bf23d32 and state 84cceba212f6443cc5d9fd67ce578a3ae0f34cba5e5877d8082748b282db0780. The original signatures and bytes have been preserved. This verification does not replace a complete synchronization test from an empty machine. The validator_set_root field is the zero placeholder emitted and accepted by this release."
        },
        {
          "kind": "p",
          "text": "Deadline: at epoch 2878, the checkpoint was 1342 epochs old within the 2016-epoch window. It is accepted but already carries a STALE warning and needs renewal. Starting at epoch 3552, on September 22, 2026 at 08:43:19 UTC (05:43:19 Brasília time), it no longer authorizes initial synchronization. Check the current epoch; ACCEPTED from the cryptographic verifier does not override an EXPIRED age warning."
        },
        {
          "kind": "p",
          "text": "Download the files below and verify the WS digest and signer-set fingerprints through another independent trusted channel. Hashes downloaded from the same site only detect changes to bytes; they do not establish trust in the signers. verification.json records the result, fingerprints and verification limits."
        },
        {
          "kind": "code",
          "text": "Original signed WS digest:\ne329e6c61ccf91e9338d94a1c1c98e4984e92ad770e995b4ce44596edae2b801"
        },
        {
          "kind": "code",
          "text": "mkdir -p checkpoint-1536\ncd checkpoint-1536\nfor file in ws-envelope.bin signer-set.bin checkpoint.bin checkpoint.json verification.json SHA256SUMS.txt; do\n  curl --fail --show-error --location --output \"$file\" \"https://blochl1.com/checkpoints/epoch-1536/$file\" || exit 1\ndone\nsha256sum --check SHA256SUMS.txt\ncd ..\n./bloch-pos ws-verify --envelope checkpoint-1536/ws-envelope.bin --signer-set checkpoint-1536/signer-set.bin --genesis mainnet.manifest --rpc 139.180.166.5:8080"
        },
        {
          "kind": "p",
          "text": "Copying a block hash, a ws_latest.bin file or a third-party snapshot is not equivalent to obtaining a signed checkpoint. Do not create your own signer set to bypass verification. The node still replays the complete history from genesis: the envelope supplies a trust anchor, not a snapshot that removes the need for replay."
        },
        {
          "kind": "p",
          "text": "Existing operator: preserve your data directory, history, metadata, key and slashing_protection.bin. Use the canonical history already validated by your own node. Do not replace a newer local anchor with epoch 1536 or delete the signing record to make a restart succeed."
        }
      ]
    },
    {
      "id": "chaves",
      "title": "4. Prepare the validator identity",
      "blocks": [
        {
          "kind": "p",
          "text": "For production, generate and back up the identity and RANDAO material in an offline human ceremony using verified tools. The node’s keygen command is documented as a devnet tool; do not treat it as a production ceremony. Never send a private key, seed or password to a website, chat, support service or RPC."
        },
        {
          "kind": "p",
          "text": "A new identity uses the automatic index (sentinel 4294967295, usually represented by --index auto during key preparation). The final index comes from the on-chain registry. Do not choose an unused index yourself or modify sealed key bytes to change its index. An existing identity must retain its index and key."
        },
        {
          "kind": "p",
          "text": "The validation key must use the sealed BPOSKEY2 format. The password file must have permissions 0600 and its containing directory 0700. Keep the withdrawal authority and its backup separate from the validation key. Never run two instances with the same identity."
        },
        {
          "kind": "code",
          "text": "# Node stopped; only for an existing legacy BPOSKEY1 key:\n./bloch-pos keys seal --dir /var/lib/bloch/validator \\\n  --passphrase-file /etc/bloch/validator.pass\n\n# Inspect the identity while the node is stopped:\n./bloch-pos keys inspect --dir /var/lib/bloch/validator"
        },
        {
          "kind": "p",
          "text": "keys seal converts a legacy key in place; running it again on an already sealed key is neither necessary nor appropriate. Do not enable BLOCH_NO_DOPPELGANGER or BLOCH_KEYSTORE_ALLOW_PLAINTEXT in the production service."
        }
      ]
    },
    {
      "id": "servico",
      "title": "5. Install a Linux service",
      "blocks": [
        {
          "kind": "p",
          "text": "The example uses one validator per directory and the bloch service user. Existing operators should adapt paths to their preserved directory without overwriting it. For a new installation, proceed only after resolving the checkpoint and preparing the identity. The operator must provision the password without exposing it in arguments or shell history."
        },
        {
          "kind": "code",
          "text": "sudo useradd --system --home /var/lib/bloch --shell /usr/sbin/nologin bloch\nsudo install -d -o bloch -g bloch -m 700 /var/lib/bloch/validator\nsudo install -d -o bloch -g bloch -m 700 /etc/bloch\nsudo install -m 755 bloch-pos /usr/local/bin/bloch-pos\nsudo install -m 644 mainnet.manifest /var/lib/bloch/mainnet.manifest\nsudo install -m 644 carryover.tsv /var/lib/bloch/carryover.tsv"
        },
        {
          "kind": "p",
          "text": "Do not repeat useradd if the user already exists. Place validator.key in /var/lib/bloch/validator and the password in /etc/bloch/validator.pass, both owned by bloch with permissions 0600. When migrating an existing identity, also transfer its history and signing record, only after stopping and disabling the old instance."
        },
        {
          "kind": "p",
          "text": "Write the unit below to /etc/systemd/system/bloch-validator.service. The devnet transport is the transport used by this Genesis-4 fleet; its name does not select a test network. The example allows outbound connections to both bootnodes and keeps RPC, metrics and the P2P listening port local."
        },
        {
          "kind": "code",
          "text": "[Unit]\nDescription=Bloch Genesis-4 validator\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=bloch\nGroup=bloch\nWorkingDirectory=/var/lib/bloch\nEnvironment=BLOCH_KEYSTORE_PASSPHRASE_FILE=/etc/bloch/validator.pass\nUnsetEnvironment=BLOCH_NO_DOPPELGANGER BLOCH_KEYSTORE_ALLOW_PLAINTEXT\nExecStart=/usr/local/bin/bloch-pos run --data-dir /var/lib/bloch/validator --genesis /var/lib/bloch/mainnet.manifest --carryover /var/lib/bloch/carryover.tsv --transport devnet --listen 19000 --listen-addr 127.0.0.1 --peers 139.180.166.5:19100,139.180.173.231:19100 --rpc-bind 127.0.0.1 --rpc-port 16400 --metrics-bind 127.0.0.1 --metrics-port 17400\nRestart=on-failure\nRestartSec=5\nLimitNOFILE=65535\nUMask=0077\n\n[Install]\nWantedBy=multi-user.target"
        },
        {
          "kind": "code",
          "text": "sudo install -m 644 checkpoint-1536/ws-envelope.bin /var/lib/bloch/checkpoint.envelope.bin\nsudo install -m 644 checkpoint-1536/signer-set.bin /var/lib/bloch/signer-set.bin"
        },
        {
          "kind": "p",
          "text": "This ExecStart assumes your own history is already trusted. On a new node with valid trust files, append to the same ExecStart line: --ws-checkpoint /var/lib/bloch/checkpoint.envelope.bin --ws-signer-set /var/lib/bloch/signer-set.bin. Both files are public and must be readable by the bloch user. Never use an incomplete command containing ellipses in the service."
        },
        {
          "kind": "code",
          "text": "sudo systemd-analyze verify /etc/systemd/system/bloch-validator.service\nsudo systemctl daemon-reload\nsudo systemctl enable --now bloch-validator.service\nsudo systemctl status bloch-validator.service\nsudo journalctl -u bloch-validator.service -f"
        },
        {
          "kind": "p",
          "text": "The RPC does not provide authentication itself. Keep it on loopback; for remote access, use an SSH tunnel or an authenticated proxy in your infrastructure. Do not expose ports 16400 or 17400 to the internet. If you need inbound external P2P connections, explicitly plan the interface and firewall separately from the RPC."
        }
      ]
    },
    {
      "id": "admissao",
      "title": "6. Register a new identity once admission is open",
      "blocks": [
        {
          "kind": "p",
          "text": "Skip this section for an already registered identity. A running, synchronized server does not prove registration. Query getvalidatoradmission on your node and confirm active: true, the network domain, minimum stake, fee and queue limits. Review the pending withdrawal-cycle qualification before committing funds; protocol activation does not establish that qualification."
        },
        {
          "kind": "code",
          "text": "curl --fail-with-body -sS http://127.0.0.1:16400/ \\\n  -H 'Content-Type: application/json' \\\n  --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getvalidatoradmission\",\"params\":[]}'"
        },
        {
          "kind": "p",
          "text": "Funded admission consumes real UTXOs from a funding authority with a suite-1 hybrid key. This version defines a minimum of 25,000 BLCH (2,500,000,000,000 sat), subject to RPC verification and inclusion rules. A legacy balance does not guarantee that its outputs have the required format. Query listunspent and verify ownership, values and scripts."
        },
        {
          "kind": "p",
          "text": "Prepare the deposit offline and sign the funding and validation roles separately. Values in <...> below are fields to replace and verify; do not copy the transaction as if it were ready to submit. The withdrawal credential must correspond to a spending key you control."
        },
        {
          "kind": "code",
          "text": "bloch-pos validator-deposit prepare \\\n  --genesis mainnet.manifest \\\n  --funding-pubkey funding.pub.hex --validator-pubkey validator.pub.hex \\\n  --randao <commitment-hex32> --withdrawal <withdrawal-script-hex32> \\\n  --change <change-script-hex32> --stake 2500000000000 \\\n  --input <txid-hex32>:<vout>:<value-sat> \\\n  --max-base-fee <millisat-per-gas> --tip <millisat-per-gas> \\\n  --expiry <inclusive-epoch> --commission <basis-points> --out draft.hex\n\nbloch-pos validator-deposit inspect --tx draft.hex\nbloch-pos validator-deposit sign --genesis mainnet.manifest \\\n  --tx draft.hex --role funding --dir funding-keystore --out funded.hex\nbloch-pos validator-deposit inspect --tx funded.hex\nbloch-pos validator-deposit sign --genesis mainnet.manifest \\\n  --tx funded.hex --role validator --dir validator-keystore --out ready.hex\nbloch-pos validator-deposit inspect --tx ready.hex"
        },
        {
          "kind": "p",
          "text": "Each signature uses its own key’s password through BLOCH_KEYSTORE_PASSPHRASE_FILE, without a password argument. Review the network, UTXOs, withdrawal credential, commission, fee and expiry on each machine. The CLI does not broadcast. Only after protocol admission is active and your review is complete, send the hexadecimal contents of ready.hex using sendrawtransaction to your own node or an authenticated endpoint. This explorer’s /rpc is read-only and does not broadcast deposits."
        },
        {
          "kind": "p",
          "text": "Track gettxstatus using the transaction ID and getvalidatorbykey using the public key’s SHA3-256 hash. Activation requires finalized registration, at least eight epochs (128 minutes), and respects the limit of four new validators per epoch. The wait may be longer; do not infer activation from elapsed time."
        }
      ]
    },
    {
      "id": "validacao",
      "title": "7. Confirm synchronization and participation",
      "blocks": [
        {
          "kind": "code",
          "text": "curl --fail-with-body -sS http://127.0.0.1:16400/ \\\n  -H 'Content-Type: application/json' \\\n  --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getchaininfo\",\"params\":[]}'\ncurl --fail-with-body -sS http://127.0.0.1:17400/metrics\nsudo journalctl -u bloch-validator.service --since '30 minutes ago'"
        },
        {
          "kind": "p",
          "text": "Wait for replay to finish and the RPC to respond. behind_by_slots at 0–1 indicates that the node is following the head at that moment. Also check that height and finalized epoch advance. Compare the same block and checkpoint across references; similar heights alone do not prove the chain is the same."
        },
        {
          "kind": "p",
          "text": "The default observation window for duplicate instances is 64 slots after replay, approximately 32 minutes. A registered, eligible identity starts its duties after this window. Look for attested and proposing block in the logs. Not every slot is a duty for your validator; a proposal may take time to occur."
        },
        {
          "kind": "p",
          "text": "For the fleet migration, qualification requires following the canonical chain and advancing three finalized epochs after the first attestation. The example service does not automatically install the fleet’s private monitor: implement your own alerts and confirm that duties are included on-chain. A signing log alone does not prove inclusion."
        },
        {
          "kind": "p",
          "text": "Monitor memory, free space, peers, lag, finalization, restarts and protection messages. Also consult /validators and /validators/queues in this explorer. A website proxy failure does not prove the chain has stopped; check your local RPC."
        }
      ]
    },
    {
      "id": "atualizacao",
      "title": "8. Upgrade or migrate without duplicating the identity",
      "blocks": [
        {
          "kind": "p",
          "text": "Before changing releases, verify the hashes, network, activation epochs and compatibility with your history. Stop the service and confirm the process has ended before moving data or inspecting the key. Make a consistent backup of the stopped directory, including validator.key, slashing_protection.bin, blocks.log, meta.bin and ws_latest.bin, with the password stored separately."
        },
        {
          "kind": "code",
          "text": "sudo systemctl stop bloch-validator.service\nsudo systemctl show bloch-validator.service -p MainPID -p ActiveState\n# MainPID must be 0 before replacement or transfer.\n# Verify the new release and make a consistent backup before installing.\nsudo install -m 755 /path/to/verified-release/bloch-pos /usr/local/bin/bloch-pos\nsudo systemctl start bloch-validator.service\nsudo journalctl -u bloch-validator.service -f"
        },
        {
          "kind": "p",
          "text": "When changing servers, disable the old instance and prevent it from starting before activating the new one. Preserve the key, RANDAO seed and most recent signing record together. An old journal backup may permit conflicting signatures: do not restore it as a shortcut. Do not run two copies, even for a few seconds."
        },
        {
          "kind": "p",
          "text": "If the node follows another branch, stops due to protection or loses its journal, keep signing stopped and investigate. Do not delete metadata, reduce the observation window or use an old binary to force resumption. Reverting a version after a consensus change requires specific analysis."
        }
      ]
    },
    {
      "id": "saida",
      "title": "9. Exit and withdrawal",
      "blocks": [
        {
          "kind": "p",
          "text": "After lifecycle activation, an exit is authenticated by the validator key. Query the current epoch and registry before signing. The exit’s inclusion epoch must match the signed epoch; an expired transaction must be recreated. The following tools generate files offline and do not broadcast."
        },
        {
          "kind": "code",
          "text": "bloch-pos validator-lifecycle exit --dir validator-keystore \\\n  --epoch <inclusion-epoch> --out exit.hex\n\nbloch-pos validator-lifecycle withdraw --validator <assigned-index> \\\n  --out withdraw.hex"
        },
        {
          "kind": "p",
          "text": "Exit does not release funds immediately. In this version, the exit delay is 32 epochs and the withdrawal delay is 2,048 epochs; check eligibility in the registry. Withdrawal pays the registered credential, not an address chosen at withdrawal time. Penalties and whether the principal was funded affect the redeemable amount. Preserve the credential’s spending authority to use the received output."
        }
      ]
    },
    {
      "id": "problemas",
      "title": "10. Quick troubleshooting and references",
      "blocks": [
        {
          "kind": "p",
          "text": "RPC refused during replay: monitor journalctl and wait for initialization. Key refused: check the sealed format, ownership and password-file permissions. Identity ineligible: query getvalidatorbykey and the queue. Persistent lag: check the clock, peers, CPU, disk and checkpoint. Duplicate-instance alert: stop signing and locate the other instance before restarting."
        },
        {
          "kind": "p",
          "text": "This guide covers operation and preparation. A new participant still needs the trust artifacts and admission to be effectively open. The attached technical documents are references for the reviewed version and do not guarantee immediate entry. Renew the published checkpoint before the deadline in section 3."
        }
      ]
    }
  ]
} as const;
