#!/usr/bin/env bash
# Download and verify public files only. Does not create keys or submit funds.
set -euo pipefail
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'This release requires Linux x86_64.' >&2; exit 1; }
for command in curl sha256sum gzip; do command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }; done
work_dir=${1:-"$PWD/bloch-validator-20260914"}
[[ ! -e "$work_dir" ]] || { echo 'Choose a new directory; existing data will not be overwritten.' >&2; exit 1; }
umask 077
mkdir -p "$work_dir"
cd "$work_dir"
release=https://blochl1.com/releases/2026-09-14
checkpoint=https://blochl1.com/checkpoints/epoch-1536
for file in bloch-pos-linux-x86_64 mainnet.manifest carryover.tsv.gz; do
  curl --fail --show-error --location --retry 2 --output "$file" "$release/$file"
done
cat > SHA256SUMS.txt <<'HASHES'
b3171d1227333284d65c7f60ac925d9e49123908d4c5fcb124ede3f1568a1084  bloch-pos-linux-x86_64
7eef82a70ef9b0e1dd86f86d33cba11fc10cdfc7395c2e5f6669613fa1beb2dd  mainnet.manifest
4d1e2738baec39ec25e2e33968f72a47abb261f271de62fb48a33be55bfc83be  carryover.tsv.gz
HASHES
sha256sum --check SHA256SUMS.txt
for file in ws-envelope.bin signer-set.bin; do
  curl --fail --show-error --location --retry 2 --output "$file" "$checkpoint/$file"
done
cat > CHECKPOINT-SHA256SUMS.txt <<'HASHES'
b700342a869e9d76f96e43d0dca30a6715d16a6fc23eadf22f69bd2c6a14fb0c  ws-envelope.bin
b2ea7f0ca9356a3d82bcd2a3f6a1e1a1b997a809b3bc91a063c90d7852566643  signer-set.bin
HASHES
sha256sum --check CHECKPOINT-SHA256SUMS.txt
gzip -dk carryover.tsv.gz
printf '%s\n' '84ddbbac2afdd5c78618096a7d4f66cf5b04a3e5757a03fe90550e50096183f6  carryover.tsv' | sha256sum --check
mv bloch-pos-linux-x86_64 bloch-pos
chmod 755 bloch-pos
./bloch-pos selfcheck
# The cryptographic verifier reports expiry but does not use it as its exit code.
# Enforce the checkpoint window separately against the host's synchronized clock.
now=$(date -u +%s)
if (( now < 1789425319 )); then
  echo 'Admission is scheduled for 2026-09-14 22:35:19 UTC; node synchronization can start now.'
fi
if (( now >= 1790066599 )); then
  echo 'The epoch-1536 checkpoint has expired. Obtain a renewed checkpoint before starting.' >&2
  exit 1
fi
./bloch-pos ws-verify --envelope ws-envelope.bin --signer-set signer-set.bin --genesis mainnet.manifest --rpc 139.180.166.5:8080
mkdir data
cat > run-node.sh <<'RUN'
#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec ./bloch-pos run --data-dir data --genesis mainnet.manifest --carryover carryover.tsv \
  --ws-checkpoint ws-envelope.bin --ws-signer-set signer-set.bin \
  --transport devnet --listen 19000 --listen-addr 127.0.0.1 \
  --peers 139.180.166.5:19100,139.180.173.231:19100 \
  --rpc-bind 127.0.0.1 --rpc-port 16400 --metrics-bind 127.0.0.1 --metrics-port 17400
RUN
chmod 755 run-node.sh
printf '\nPublic files verified in %s\n' "$PWD"
printf '%s\n' 'Verify the signer-set fingerprint through an independent trusted channel.' 'Start ./run-node.sh without a key to synchronize as an observer.' 'Follow the onboarding guide before installing a validator identity or submitting a deposit.'
