# Renew the Bloch Genesis-4 checkpoint

Use the verified release executable, `mainnet.manifest` and the existing `signer-set.bin` (ID 1). Do not generate another signer set for this renewal. Prepare the files in a new directory to avoid overwriting the previous ceremony.

## 1. Choose a finalized epoch and extract the checkpoint

Query `getchaininfo` on both RPCs and choose a recent epoch already finalized on both (`result.finalized.epoch`), preferably on the 256-epoch publication interval. Do not use the current epoch without confirming finalization. Both RPCs below are public references operated by the same organization; each signer should also check their own trusted reference.

```sh
for rpc in 139.180.166.5:8080 139.180.173.231:8080; do
  curl --fail --show-error --max-time 20 \
    -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"getchaininfo","params":[]}' \
    "http://$rpc/" || exit 1
  printf '\n'
done
```

Replace `FINALIZED_EPOCH` with the chosen number. The command refuses disagreement between references and epochs that have not been finalized.

```sh
./bloch-pos ws-checkpoint \
  --genesis mainnet.manifest \
  --rpc 139.180.166.5:8080,139.180.173.231:8080 \
  --epoch FINALIZED_EPOCH \
  --signer-set-id 1 \
  --out checkpoint

./bloch-pos ws-verify --checkpoint checkpoint.bin
```

This produces `checkpoint.bin` and `checkpoint.json`. Record the WS digest. Distribute these exact bytes to all three signers. Do not regenerate the checkpoint between signatures: `issued_at` is part of the digest.

To reproduce the extraction independently, each signer uses their own RPC, the same epoch, `--signer-set-id 1`, and **`--issued-at` matching the received checkpoint.json exactly**. Compare the bytes/digest and the network, block and state fields before signing. Running `ws-verify --checkpoint` alone decodes the file; it does not query the chain.

## 2. Each person signs offline

On each signer’s offline machine, verify the digest through another trusted channel and run the command with that signer’s own key. `signer.sk` below is an illustrative path: use the correct private file from the ceremony. The key and password never leave that machine.

The supplied public keys confirm this mapping: first directory = index 0; second = index 1; third = index 2. These are signer-set indices, not network validator indices.

```sh
# Person A: index 0, using their own key
./bloch-pos ws-verify --checkpoint checkpoint.bin
./bloch-pos ws-sign --key signer.sk --pubkey signer.pk \
  --checkpoint checkpoint.bin --signer-index 0 --out signerA.partial

# Person B: index 1, on their own machine
./bloch-pos ws-sign --key signer.sk --pubkey signer.pk \
  --checkpoint checkpoint.bin --signer-index 1 --out signerB.partial

# Person C: index 2, on their own machine
./bloch-pos ws-sign --key signer.sk --pubkey signer.pk \
  --checkpoint checkpoint.bin --signer-index 2 --out signerC.partial
```

Each person returns only their `.partial` file. Everyone must verify the checkpoint before signing, as shown for A. Signatures from epoch 1536 or 3328 do not sign a new checkpoint payload.

## 3. Assemble and verify the envelope

On the coordinator’s machine, after receiving all three public files:

```sh
./bloch-pos ws-envelope \
  --checkpoint checkpoint.bin --signer-set signer-set.bin \
  --sig 0:signerA.partial --sig 1:signerB.partial --sig 2:signerC.partial \
  --genesis mainnet.manifest --out ws-envelope.bin

./bloch-pos ws-verify \
  --envelope ws-envelope.bin --signer-set signer-set.bin \
  --genesis mainnet.manifest --rpc 139.180.166.5:8080 --require-fresh

./bloch-pos ws-verify \
  --envelope ws-envelope.bin --signer-set signer-set.bin \
  --genesis mainnet.manifest --rpc 139.180.173.231:8080 --require-fresh
```

Require all three signatures to be `VALID`, the verdict to be `ACCEPTED`, and the age to be `FRESH`. The envelope verifier queries the RPC epoch to calculate age; block comparison took place during extraction. Do not confuse cryptographic validity with absence of expiry.

## 4. Publish the public files

Publish in a new directory for each epoch: `ws-envelope.bin`, `signer-set.bin`, `checkpoint.bin`, `checkpoint.json` and hashes. On macOS:

```sh
shasum -a 256 ws-envelope.bin signer-set.bin checkpoint.bin checkpoint.json > SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt
```

On Linux, use `sha256sum` and `sha256sum --check`. Also publish the WS digest and signer-set fingerprint through another independent trusted channel. Update the guide and deadline: initial synchronization refuses the checkpoint when `current_epoch - checkpoint_epoch >= 2016`. Never publish `signer.sk`, validator keys or a complete copy of the ceremony directories.

The September 30 distribution uses the existing historical checkpoint at epoch 3328. Its signatures were verified, but all three keys were used on one Mac and independent custody remains unverified; see the [verification record](/checkpoints/epoch-3328/verification.json). It must be replaced before epoch 5344: October 12, 2026 at 06:35:19.962 UTC (03:35:19.962 Brasília time). Signing a new checkpoint requires new human signatures; these commands do not automate those signatures or publish files on their own.
