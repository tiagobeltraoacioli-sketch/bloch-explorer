#!/usr/bin/env bash
# Download and verify public files only. Does not create keys or submit funds.
# The 2026-10-09 stable release: node 3a68f10b (funded delegation, active since epoch 4669).
# Earlier releases reject funded-delegation blocks and leave the canonical chain.
set -euo pipefail
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'This release requires Linux x86_64.' >&2; exit 1; }
for command in curl sha256sum gzip minisign getconf date; do command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }; done
glibc_info=$(getconf GNU_LIBC_VERSION 2>/dev/null) || { echo 'This executable requires glibc 2.34 or newer.' >&2; exit 1; }
read -r glibc_name glibc_version <<< "$glibc_info"
IFS=. read -r glibc_major glibc_minor <<< "$glibc_version"
[[ "$glibc_name" == glibc && "$glibc_major" =~ ^[0-9]+$ && "$glibc_minor" =~ ^[0-9]+$ ]] || exit 1
(( 10#$glibc_major > 2 || (10#$glibc_major == 2 && 10#$glibc_minor >= 34) )) || { echo 'glibc 2.34 or newer is required.' >&2; exit 1; }

# From the pinned BPOSMAN1 mainnet.manifest: LE u64 at offsets 8 and 16.
# genesis_time_ms=1786656679962, slot_ms=30000; 32 slots per epoch.
# Checkpoint epoch 5120 expires at epoch 7136: 2026-11-01T04:27:19.962Z.
# Milliseconds preserve the boundary; do not round the genesis time to seconds.
check_checkpoint_clock() {
  local now_ms
  now_ms=$(date -u +%s%3N)
  [[ "$now_ms" =~ ^[0-9]{13}$ ]] || { echo 'A synchronized clock and GNU date with millisecond support are required.' >&2; return 1; }
  (( now_ms >= 1786656679962 )) || { echo 'The host clock precedes mainnet genesis.' >&2; return 1; }
  now_epoch=$(( (now_ms - 1786656679962) / 960000 ))
  (( now_epoch >= 5120 )) || { echo 'The host clock precedes the epoch-5120 checkpoint.' >&2; return 1; }
  (( now_epoch < 7136 )) || { echo 'The epoch-5120 checkpoint has expired. Obtain a renewed checkpoint before starting.' >&2; return 1; }
}
check_checkpoint_clock
work_dir=${1:-"$PWD/bloch-validator-20261009"}
[[ ! -e "$work_dir" && ! -L "$work_dir" ]] || { echo 'Choose a new directory; existing data will not be overwritten.' >&2; exit 1; }
umask 077
mkdir -- "$work_dir"
cd -- "$work_dir"
release=https://blochl1.com/releases/2026-10-09
genesis_release=https://blochl1.com/releases/2026-09-14
checkpoint=https://blochl1.com/checkpoints/epoch-5120
fetch() {
  curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
    --retry 2 --connect-timeout 15 --max-time 300 --output "$1" "$2"
}
for file in bloch-pos SHA256SUMS SHA256SUMS.minisig; do
  fetch "$file" "$release/$file"
done
# Pin both the exact canonical manifest and the previously published release key.
# A key downloaded alongside the package is not an independent trust root.
printf '%s\n' 'b6815db586afedf258065f417bb76385db92814a5a7b406ea5be6bf180ac13b1  SHA256SUMS' | sha256sum --check
minisign -Vm SHA256SUMS -P RWT3XpXEpZZdGtghC5SmyRj2VRTAGUfO5KxBucYVTRfriNE13wsXhfj6
sha256sum --check SHA256SUMS
for file in mainnet.manifest carryover.tsv.gz; do
  fetch "$file" "$genesis_release/$file"
done
cat > SOURCE-SHA256SUMS.txt <<'HASHES'
22478fc5797ff673d390ed91b5b6a5120aa389b9bdbf798cf6b1abf99e60f7ba  bloch-pos
7eef82a70ef9b0e1dd86f86d33cba11fc10cdfc7395c2e5f6669613fa1beb2dd  mainnet.manifest
4d1e2738baec39ec25e2e33968f72a47abb261f271de62fb48a33be55bfc83be  carryover.tsv.gz
HASHES
sha256sum --check SOURCE-SHA256SUMS.txt
for file in ws-envelope.bin signer-set.bin; do
  fetch "$file" "$checkpoint/$file"
done
cat > CHECKPOINT-SHA256SUMS.txt <<'HASHES'
d7e3c73223617d24cb23eb9898a6e855e915450c6474815d55e121a8fcfc9cb5  ws-envelope.bin
b2ea7f0ca9356a3d82bcd2a3f6a1e1a1b997a809b3bc91a063c90d7852566643  signer-set.bin
HASHES
sha256sum --check CHECKPOINT-SHA256SUMS.txt
gzip -dk carryover.tsv.gz
printf '%s\n' '84ddbbac2afdd5c78618096a7d4f66cf5b04a3e5757a03fe90550e50096183f6  carryover.tsv' | sha256sum --check
# Re-evaluate after downloads; do not generate a launcher from an expired anchor.
check_checkpoint_clock
chmod 755 bloch-pos
./bloch-pos selfcheck
./bloch-pos ws-verify --envelope ws-envelope.bin --signer-set signer-set.bin \
  --genesis mainnet.manifest --now-epoch "$now_epoch" --require-fresh
mkdir data
cat > run-node.sh <<'RUN'
#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec ./bloch-pos run --data-dir data --genesis mainnet.manifest --carryover carryover.tsv \
  --ws-checkpoint ws-envelope.bin --ws-signer-set signer-set.bin \
  --ws-signer-set-sha3 bccb7c5ee127f806ac7da69a6dfab0a0b1c3d2750d6224bbfb652baa3322d627 \
  --transport devnet --listen 19000 --listen-addr 127.0.0.1 \
  --peers 139.180.166.5:19100,139.180.173.231:19100 \
  --rpc-bind 127.0.0.1 --rpc-port 16400 --metrics-bind 127.0.0.1 --metrics-port 17400
RUN
chmod 755 run-node.sh
printf '\nPublic files verified in %s\n' "$PWD"
printf '%s\n' 'Verify the signer-set fingerprint through an independent trusted channel.' \
  'Checkpoint 5120 has three valid signatures; independent signer custody is not established.' \
  'Start ./run-node.sh without a key to synchronize as an observer.' \
  'Follow the onboarding guide before installing a validator identity or submitting a deposit.'
