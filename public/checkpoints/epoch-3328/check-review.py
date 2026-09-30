#!/usr/bin/env python3
"""Check this public review package without claiming independent custody."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

EXPECTED = ['PUBLICATION-DECISION-20260930.json', 'PUBLICATION-HOLD', 'README.txt', 'SHA256SUMS.txt', 'check-review.py', 'checkpoint.bin', 'checkpoint.json', 'live-observation.json', 'logs/checkpoint.txt', 'logs/envelope.txt', 'logs/partial-0.txt', 'logs/partial-1.txt', 'logs/partial-2.txt', 'logs/version.txt', 'partials/signer-0.partial', 'partials/signer-1.partial', 'partials/signer-2.partial', 'signer-set.bin', 'verification.json', 'ws-envelope.bin']
MAX_FILE_BYTES = 2 * 1024 * 1024

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-independent-publication', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    paths = list(root.rglob('*'))
    if any(p.is_symlink() for p in paths):
        raise ValueError('symlinks are not permitted in the review package')
    names = {str(p.relative_to(root)) for p in paths if p.is_file()}
    if names != set(EXPECTED) | {'SHA256SUMS'}:
        raise ValueError('unexpected or missing package file')
    if any(p.stat().st_size > MAX_FILE_BYTES for p in paths if p.is_file()):
        raise ValueError('package file exceeds size limit')
    lines = (root / 'SHA256SUMS').read_text(encoding='ascii').splitlines()
    if len(lines) != len(EXPECTED):
        raise ValueError('checksum manifest entry count mismatch')
    seen = set()
    for line in lines:
        match = re.fullmatch(r'([0-9a-f]{64})  ([a-zA-Z0-9._/-]+)', line)
        if not match:
            raise ValueError('invalid checksum manifest record')
        digest, name = match.groups()
        if name not in EXPECTED or name in seen:
            raise ValueError('unapproved or repeated manifest path')
        seen.add(name)
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
            raise ValueError('package checksum mismatch')
    report = json.loads((root / 'verification.json').read_text())
    decision = json.loads((root / 'PUBLICATION-DECISION-20260930.json').read_text())
    pub = report['publication']
    checks = report['checks']
    if report['schema'] != 'bloch.checkpoint.publication-verification.v1' or report['checkpoint']['epoch'] != 3328:
        raise ValueError('unexpected checkpoint review')
    if pub['operator_authorized_use'] is not True or decision['operator_authorized_use_of_existing_checkpoint'] is not True:
        raise ValueError('operator authorization is not recorded')
    if pub['original_hold_preserved'] is not True or pub['historical_signatures'] is not True:
        raise ValueError('historical custody limits were not preserved')
    if pub['new_signatures_produced'] != 0 or pub['independent_custody_verified'] is not False or pub['independent_publication_claim_allowed'] is not False:
        raise ValueError('this historical package must not claim new signatures or independent custody')
    if decision['independent_custody_verified'] is not False or decision['operator_exception_to_historical_publication_hold'] is not True:
        raise ValueError('operator decision scope does not match this review')
    if checks['native_verdict'] != 'ACCEPTED' or checks['verified_signatures'] != 3 or checks['native_envelope_exit_status'] != 0:
        raise ValueError('successful historical signature verification is not recorded')
    for name, record in report['artifacts'].items():
        if name not in EXPECTED or hashlib.sha256((root / name).read_bytes()).hexdigest() != record['sha256']:
            raise ValueError('artifact binding mismatch')
    live_reference = report['live_observation']
    if live_reference['file'] != 'live-observation.json' or live_reference['offline_signature_reference_epoch_unchanged'] != 4295 or report['current_epoch_reference']['epoch'] != 4295:
        raise ValueError('live and offline observation contexts were conflated')
    live_bytes = (root / 'live-observation.json').read_bytes()
    if hashlib.sha256(live_bytes).hexdigest() != live_reference['sha256']:
        raise ValueError('live observation digest mismatch')
    live = json.loads(live_bytes)
    if live['schema'] != 'bloch.checkpoint.public-live-anchor-observation.v1' or live['checkpoint_epoch'] != 3328 or live['queried_slot'] != 106493:
        raise ValueError('unexpected live anchor observation')
    if live['expected_block_root'] != report['checkpoint']['block_root'] or live['expected_state_root'] != report['checkpoint']['state_root'] or live['checkpoint_ws_digest'] != report['checkpoint']['ws_digest']:
        raise ValueError('live observation checkpoint binding mismatch')
    if live['independent_operators_verified'] is not False or live['cryptographic_ancestry_proof_collected'] is not False or live['independent_custody_verified'] is not False:
        raise ValueError('RPC agreement must not claim independent operators, ancestry proof or custody')
    if live['both_public_endpoints_match_checkpoint_and_report_later_finalization'] is not True:
        raise ValueError('live anchor comparison is incomplete')
    if args.require_independent_publication:
        print('REFUSED: independent custody remains unverified; operator authorization does not establish it.', file=sys.stderr)
        return 2
    print(json.dumps({'package_integrity':'valid','operator_authorized_historical_publication':True,'independent_custody_verified':False,'new_cryptographic_verification_performed':False,'network_queried':False}))
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError):
        print('REFUSED: invalid, incomplete or modified checkpoint review package.', file=sys.stderr)
        sys.exit(1)
