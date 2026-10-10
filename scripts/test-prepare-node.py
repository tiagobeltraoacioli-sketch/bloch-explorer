#!/usr/bin/env python3
"""Exercise the download helper offline; no real node, keys, funds or RPC.

Downloads, signatures and the executable are mocked. SHA-256 checks use real
hashlib digests of disposable fixture bytes; only the fixture copy of the helper
receives fixture pins. Production pins and artifact bindings are checked too.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'public/downloads/prepare-node.sh'
GENESIS_MS = 1786656679962
EPOCH_MS = 960000
EXPIRES_MS = GENESIS_MS + 7136 * EPOCH_MS
PUBKEY = 'RWT3XpXEpZZdGtghC5SmyRj2VRTAGUfO5KxBucYVTRfriNE13wsXhfj6'
SHIM = r'''#!/usr/bin/env python3
import hashlib, json, os, pathlib, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
def record():
    with open(os.environ['MOCK_LOG'], 'a') as out:
        out.write(json.dumps([name, *args]) + '\n')
record()
if name == 'uname':
    print('Linux' if args == ['-s'] else 'x86_64')
elif name == 'getconf':
    print('glibc 2.34')
elif name == 'date':
    assert args == ['-u', '+%s%3N']
    counter = pathlib.Path(os.environ['MOCK_CLOCK_COUNT'])
    previous = int(counter.read_text()) if counter.exists() else 0
    counter.write_text(str(previous + 1))
    print(os.environ.get('MOCK_NOW_AFTER', os.environ['MOCK_NOW']) if previous else os.environ['MOCK_NOW'])
elif name == 'curl':
    output = args[args.index('--output') + 1]
    base = 'https://blochl1.com/'
    release = ['bloch-pos', 'SHA256SUMS', 'SHA256SUMS.minisig']
    genesis = ['mainnet.manifest', 'carryover.tsv.gz']
    allowed = {base + 'releases/2026-10-09/' + x: x for x in release}
    allowed.update({base + 'releases/2026-09-14/' + x: x for x in genesis})
    allowed.update({base + 'checkpoints/epoch-5120/' + x: x for x in ['ws-envelope.bin', 'signer-set.bin']})
    assert allowed[args[-1]] == output
    assert args[args.index('--proto') + 1] == '=https'
    assert args[args.index('--proto-redir') + 1] == '=https'
    shutil.copyfile(pathlib.Path(os.environ['MOCK_FIXTURES']) / output, output)
elif name == 'sha256sum':
    assert args[0] == '--check'
    text = pathlib.Path(args[1]).read_text() if len(args) == 2 else sys.stdin.read()
    for row in text.splitlines():
        digest, filename = row.split('  ', 1)
        if hashlib.sha256(pathlib.Path(filename).read_bytes()).hexdigest() != digest:
            print('checksum mismatch: ' + filename, file=sys.stderr)
            sys.exit(1)
elif name == 'minisign':
    assert args == ['-Vm', 'SHA256SUMS', '-P', 'RWT3XpXEpZZdGtghC5SmyRj2VRTAGUfO5KxBucYVTRfriNE13wsXhfj6']
    assert pathlib.Path('SHA256SUMS.minisig').read_text() == 'mock signature\n'
    if os.environ.get('MOCK_BAD_SIGNATURE'):
        sys.exit('signature refused')
elif name == 'bloch-pos':
    assert args[0] in ['selfcheck', 'ws-verify', 'run'], 'unexpected operation'
    if args[0] == 'ws-verify':
        for flag, value in [('--envelope', 'ws-envelope.bin'), ('--signer-set', 'signer-set.bin'), ('--genesis', 'mainnet.manifest')]:
            assert args[args.index(flag) + 1] == value
        assert '--require-fresh' in args and '--rpc' not in args
        assert 5120 <= int(args[args.index('--now-epoch') + 1]) < 7136
        if os.environ.get('MOCK_REFUSE_ENVELOPE'):
            sys.exit('envelope refused')
    if args[0] == 'run':
        assert args[args.index('--ws-signer-set-sha3') + 1] == 'bccb7c5ee127f806ac7da69a6dfab0a0b1c3d2750d6224bbfb652baa3322d627'
        assert args[args.index('--ws-checkpoint') + 1] == 'ws-envelope.bin'
else:
    raise AssertionError(name)
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


class PrepareNodeTests(unittest.TestCase):
    def run_helper(self, *, corrupt=None, bad_signature=False, refuse_envelope=False,
                   now=GENESIS_MS + 5148 * EPOCH_MS, now_after=None,
                   existing=False, dangling=False, launch=False):
        with tempfile.TemporaryDirectory(prefix='bloch-prepare-node-') as tmp:
            root = Path(tmp)
            shims = root / 'bin'
            shims.mkdir()
            fixtures = root / 'fixtures'
            fixtures.mkdir()
            for name in ['uname', 'getconf', 'date', 'curl', 'sha256sum', 'minisign']:
                path = shims / name
                path.write_text(SHIM)
                path.chmod(0o700)
            binary = SHIM.encode()
            carryover = b'synthetic carryover fixture, not a ledger\n'
            manifest = (ROOT / 'public/releases/2026-09-14/mainnet.manifest').read_bytes()
            files = {
                'bloch-pos': binary,
                'SHA256SUMS': (digest(binary) + '  bloch-pos\n').encode(),
                'SHA256SUMS.minisig': b'mock signature\n',
                'mainnet.manifest': manifest,
                'carryover.tsv.gz': gzip.compress(carryover, mtime=0),
                'ws-envelope.bin': b'synthetic envelope fixture',
                'signer-set.bin': b'synthetic signer-set fixture',
            }
            substitutions = {
                '22478fc5797ff673d390ed91b5b6a5120aa389b9bdbf798cf6b1abf99e60f7ba': digest(binary),
                'b6815db586afedf258065f417bb76385db92814a5a7b406ea5be6bf180ac13b1': digest(files['SHA256SUMS']),
                '4d1e2738baec39ec25e2e33968f72a47abb261f271de62fb48a33be55bfc83be': digest(files['carryover.tsv.gz']),
                '84ddbbac2afdd5c78618096a7d4f66cf5b04a3e5757a03fe90550e50096183f6': digest(carryover),
                'd7e3c73223617d24cb23eb9898a6e855e915450c6474815d55e121a8fcfc9cb5': digest(files['ws-envelope.bin']),
                'b2ea7f0ca9356a3d82bcd2a3f6a1e1a1b997a809b3bc91a063c90d7852566643': digest(files['signer-set.bin']),
            }
            source = HELPER.read_text()
            for actual, fixture in substitutions.items():
                self.assertIn(actual, source)
                source = source.replace(actual, fixture)
            helper = root / 'prepare-node.sh'
            helper.write_text(source)
            for name, content in files.items():
                (fixtures / name).write_bytes(content + (b'corrupt' if corrupt == name else b''))
            work = root / 'prepared node'
            if existing:
                work.mkdir()
                (work / 'sentinel').write_text('preserve')
            if dangling:
                work.symlink_to(root / 'missing')
            log = root / 'calls.jsonl'
            env = os.environ.copy()
            env.update(PATH=str(shims) + os.pathsep + env['PATH'], MOCK_LOG=str(log),
                       MOCK_FIXTURES=str(fixtures), MOCK_CLOCK_COUNT=str(root / 'clock-count'),
                       MOCK_NOW=str(now))
            if now_after is not None:
                env['MOCK_NOW_AFTER'] = str(now_after)
            if bad_signature:
                env['MOCK_BAD_SIGNATURE'] = '1'
            if refuse_envelope:
                env['MOCK_REFUSE_ENVELOPE'] = '1'
            result = subprocess.run(['bash', str(helper), str(work)], env=env,
                                    capture_output=True, text=True, timeout=20)
            launcher = work / 'run-node.sh'
            if launch and result.returncode == 0:
                run = subprocess.run(['bash', str(launcher)], env=env,
                                     capture_output=True, text=True, timeout=10)
                self.assertEqual(run.returncode, 0, run.stderr)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            if existing:
                self.assertEqual((work / 'sentinel').read_text(), 'preserve')
            return result, calls, launcher.exists(), work.exists()

    def test_verified_downloads_require_freshness_and_pinned_launcher(self):
        result, calls, launcher, _ = self.run_helper(launch=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(launcher)
        node = [c for c in calls if c[0] == 'bloch-pos']
        self.assertEqual([c[1] for c in node], ['selfcheck', 'ws-verify', 'run'])
        self.assertEqual(node[1][node[1].index('--now-epoch') + 1], '5148')
        self.assertLess(next(i for i, c in enumerate(calls) if c[0] == 'minisign'),
                        next(i for i, c in enumerate(calls) if c[0] == 'bloch-pos'))

    def test_corrupt_release_manifest_binary_genesis_and_checkpoint_never_execute(self):
        for filename in ['SHA256SUMS', 'bloch-pos', 'mainnet.manifest', 'carryover.tsv.gz', 'ws-envelope.bin', 'signer-set.bin']:
            with self.subTest(file=filename):
                result, calls, launcher, _ = self.run_helper(corrupt=filename)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('checksum mismatch', result.stderr)
                self.assertFalse(launcher)
                self.assertFalse(any(c[0] == 'bloch-pos' for c in calls))

    def test_invalid_signature_never_executes_node(self):
        result, calls, launcher, _ = self.run_helper(bad_signature=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('signature refused', result.stderr)
        self.assertFalse(launcher)
        self.assertFalse(any(c[0] == 'bloch-pos' for c in calls))

    def test_invalid_envelope_never_creates_launcher(self):
        result, _, launcher, _ = self.run_helper(refuse_envelope=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('envelope refused', result.stderr)
        self.assertFalse(launcher)

    def test_exact_millisecond_expiration_boundary(self):
        result, _, launcher, _ = self.run_helper(now=EXPIRES_MS - 1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(launcher)
        result, calls, launcher, work = self.run_helper(now=EXPIRES_MS)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('expired', result.stderr)
        self.assertFalse(launcher or work)
        self.assertFalse(any(c[0] == 'curl' for c in calls))

    def test_expiry_during_download_prevents_execution(self):
        result, calls, launcher, _ = self.run_helper(now_after=EXPIRES_MS)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('expired', result.stderr)
        self.assertFalse(launcher)
        self.assertFalse(any(c[0] == 'bloch-pos' for c in calls))

    def test_invalid_or_earlier_clock_never_downloads(self):
        for now in ['1790000000%3N', '999999999999999999999999', GENESIS_MS - 1,
                    GENESIS_MS + 5120 * EPOCH_MS - 1]:
            with self.subTest(now=now):
                result, calls, launcher, work = self.run_helper(now=now)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(launcher or work)
                self.assertFalse(any(c[0] == 'curl' for c in calls))

    def test_existing_directory_and_dangling_symlink_are_preserved(self):
        for option in ['existing', 'dangling']:
            with self.subTest(option=option):
                result, calls, launcher, _ = self.run_helper(**{option: True})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('existing data will not be overwritten', result.stderr)
                self.assertFalse(launcher)
                self.assertFalse(any(c[0] == 'curl' for c in calls))

    def test_production_pins_bind_published_artifacts_and_manifest_clock(self):
        source = HELPER.read_text()
        release = ROOT / 'public/releases/2026-10-09'
        for name in ['bloch-pos', 'SHA256SUMS']:
            self.assertIn(digest((release / name).read_bytes()), source)
        self.assertIn(PUBKEY, (release / 'bloch-release-20260922.pub').read_text())
        checkpoint = ROOT / 'public/checkpoints/epoch-5120'
        for name in ['ws-envelope.bin', 'signer-set.bin']:
            self.assertIn(digest((checkpoint / name).read_bytes()), source)
        self.assertIn(hashlib.sha3_256((checkpoint / 'signer-set.bin').read_bytes()).hexdigest(), source)
        genesis = (ROOT / 'public/releases/2026-09-14/mainnet.manifest').read_bytes()
        self.assertEqual(genesis[:8], b'BPOSMAN1')
        self.assertEqual(struct.unpack_from('<QQ', genesis, 8), (GENESIS_MS, EPOCH_MS // 32))
        self.assertIn(str(GENESIS_MS), source)
        self.assertIn(str(EPOCH_MS), source)


if __name__ == '__main__':
    unittest.main()
