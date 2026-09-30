#!/usr/bin/env bash
# Run manually by the key custodian on an offline Linux machine, outside any
# agent session, recording terminal, shared session or CI environment.
set +x
set +v
set -euo pipefail
[[ -t 0 && -t 1 ]] || { echo 'Run interactively on the custodian’s offline terminal.' >&2; exit 1; }
[[ $# == 2 ]] || { echo 'Usage: bash prepare-identity.sh /absolute/path/bloch-pos /absolute/path/new-identity-dir' >&2; exit 1; }
binary=$1
identity_dir=$2
[[ "$binary" == /* && "$identity_dir" == /* ]] || { echo 'Use absolute paths.' >&2; exit 1; }
[[ ! -e "$identity_dir" ]] || { echo 'Identity directory already exists; refusing to overwrite keys.' >&2; exit 1; }
printf '%s  %s\n' fb8a65cbd9721d794bd4c2151b50d82d85a7df2299d59d7bad44a7635c30b46a "$binary" | sha256sum --check
printf '%s\n' 'This invokes the current keygen utility, which retains its devnet/throwaway label.' 'The utility is not an independently qualified production custody ceremony.' 'Only the human custodian should run it offline after reviewing the code and custody requirements.'
read -r -p 'Type OFFLINE to confirm this is your private, offline terminal: ' confirmation
[[ "$confirmation" == OFFLINE ]] || exit 1
umask 077
# Do not inherit an exported variable's export attribute for either password.
unset identity_pass identity_repeat
identity_terminal_state=$(stty -g)
trap 'stty "$identity_terminal_state"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
stty -echo
read -r -s -p 'Choose a strong keystore passphrase (at least 20 characters): ' identity_pass
printf '\n'
read -r -s -p 'Repeat passphrase: ' identity_repeat
printf '\n'
stty "$identity_terminal_state"
trap - EXIT INT TERM
[[ ${#identity_pass} -ge 20 && "$identity_pass" == "$identity_repeat" ]] || { echo 'Passphrases do not match or are too short.' >&2; exit 1; }
mkdir -m 700 "$identity_dir"
printf '%s' "$identity_pass" > "$identity_dir/validator.pass"
unset identity_pass identity_repeat
export BLOCH_KEYSTORE_PASSPHRASE_FILE="$identity_dir/validator.pass"
unset BLOCH_KEYSTORE_ALLOW_PLAINTEXT BLOCH_NO_DOPPELGANGER BLOCH_KEYSTORE_PASSPHRASE
"$binary" keygen --dir "$identity_dir/keystore" --index auto
"$binary" keygen-public --dir "$identity_dir/keystore" > "$identity_dir/public.tsv"
python3 - "$identity_dir" <<'PY'
import pathlib,sys,hashlib,json
p=pathlib.Path(sys.argv[1]);fields=(p/'public.tsv').read_text().strip().split('\t')
if len(fields)<3 or fields[0]!='4294967295':
    raise SystemExit('Invalid auto-index public metadata.')
pub=bytes.fromhex(fields[1])
if len(pub)!=3749 or pub[:4]!=bytes.fromhex('b10c0100'):
    raise SystemExit('Invalid hybrid public-key length or suite.')
if len(bytes.fromhex(fields[2]))!=32:
    raise SystemExit('Invalid RANDAO commitment length.')
(p/'validator.pub.hex').write_text(fields[1]+'\n')
(p/'public.json').write_text(json.dumps({'validator_pubkey_sha3_256':hashlib.sha3_256(pub).hexdigest(),'randao_commitment':fields[2],'index':'auto'},indent=2)+'\n')
print('Public metadata written to public.json and validator.pub.hex.')
PY
printf '%s\n' 'Back up the sealed key and RANDAO material, and store the password separately.' 'Only public.tsv, public.json and validator.pub.hex belong on the coordination machine.' 'Transfer the sealed validator key and its password securely to your own validator server when ready.' 'Keep the withdrawal spending authority separate. Never run two copies of this identity.'
