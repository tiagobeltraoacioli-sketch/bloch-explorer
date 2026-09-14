#!/usr/bin/env python3
"""Exercise custody-helper shell boundaries using a fake keygen, never real keys."""
import errno
import os
from pathlib import Path
import pty
import select
import subprocess
import tempfile
import termios
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SECRET = 'disposable-test-password-987654'


class IdentityHelperTests(unittest.TestCase):
    def run_helper(self, *, short=False, existing=False, malformed=False):
        with tempfile.TemporaryDirectory(prefix='bloch-helper-test-') as tmp:
            root = Path(tmp)
            shim = root / 'sha256sum'
            # Only the external hash command is mocked. No real release binary
            # or private cryptographic material is available to this test.
            shim.write_text('#!/bin/sh\ncat >/dev/null\nexit 0\n')
            shim.chmod(0o700)
            binary = root / 'fake-keygen'
            binary.write_text('''#!/usr/bin/env python3
import os, pathlib, sys
assert 'identity_pass' not in os.environ
assert 'identity_repeat' not in os.environ
assert 'BLOCH_KEYSTORE_ALLOW_PLAINTEXT' not in os.environ
assert 'BLOCH_NO_DOPPELGANGER' not in os.environ
assert 'BLOCH_KEYSTORE_PASSPHRASE' not in os.environ
p = pathlib.Path(sys.argv[sys.argv.index('--dir') + 1])
if sys.argv[1] == 'keygen':
    p.mkdir(mode=0o700)
    (p / 'validator.key').write_text('FAKE TEST DATA, NOT A KEY')
else:
    key = 'b10c0100' + '00' * (1 if os.environ.get('MOCK_MALFORMED') else 3745)
    print('4294967295\\t' + key + '\\t' + '11' * 32 + '\\t\\t\\t')
''')
            binary.chmod(0o700)
            identity = root / 'identity'
            if existing:
                identity.mkdir()
                (identity / 'sentinel').write_text('preserve')
            env = os.environ.copy()
            env.update(PATH=str(root) + os.pathsep + env['PATH'],
                       identity_pass='inherited', identity_repeat='inherited',
                       BLOCH_KEYSTORE_ALLOW_PLAINTEXT='1', BLOCH_NO_DOPPELGANGER='1',
                       BLOCH_KEYSTORE_PASSPHRASE='inherited')
            if malformed:
                env['MOCK_MALFORMED'] = '1'
            master, slave = pty.openpty()
            original_terminal = termios.tcgetattr(master)
            proc = subprocess.Popen(['bash', '-xv', str(ROOT / 'public/downloads/prepare-identity.sh'),
                                     str(binary), str(identity)],
                                    stdin=slave, stdout=slave, stderr=slave, env=env)
            os.close(slave)
            output = bytearray()
            sent = set()
            deadline = time.monotonic() + 20
            try:
                while time.monotonic() < deadline:
                    readable, _, _ = select.select([master], [], [], 0.1)
                    if readable:
                        try:
                            chunk = os.read(master, 65536)
                        except OSError as exc:
                            if exc.errno == errno.EIO:
                                break
                            raise
                        if not chunk:
                            break
                        output.extend(chunk)
                    prompts = [(b'Type OFFLINE', b'OFFLINE\n'),
                               (b'Choose a strong', (('short' if short else SECRET) + '\n').encode()),
                               (b'Repeat passphrase:', (('short' if short else SECRET) + '\n').encode())]
                    for prompt, answer in prompts:
                        if prompt in output and prompt not in sent:
                            os.write(master, answer)
                            sent.add(prompt)
                else:
                    self.fail('helper did not finish before deadline')
                code = proc.wait(timeout=3)
                self.assertEqual(termios.tcgetattr(master), original_terminal,
                                 'helper must restore terminal settings')
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
                os.close(master)
            captured = output.decode(errors='replace')
            self.assertNotIn(SECRET, captured)
            if existing:
                self.assertNotEqual(code, 0)
                self.assertEqual((identity / 'sentinel').read_text(), 'preserve')
                self.assertFalse((identity / 'validator.pass').exists())
            elif short:
                self.assertNotEqual(code, 0)
                self.assertFalse(identity.exists())
            elif malformed:
                self.assertNotEqual(code, 0)
                self.assertFalse((identity / 'public.json').exists())
            else:
                self.assertEqual(code, 0, captured)
                self.assertEqual((identity / 'validator.pass').read_text(), SECRET)
                self.assertEqual(identity.stat().st_mode & 0o777, 0o700)
                self.assertEqual((identity / 'validator.pass').stat().st_mode & 0o777, 0o600)
                self.assertEqual((identity / 'keystore/validator.key').stat().st_mode & 0o777, 0o600)
                self.assertTrue((identity / 'public.json').exists())

    def test_tracing_and_inherited_export_do_not_disclose_password(self):
        self.run_helper()

    def test_short_password_creates_no_identity(self):
        self.run_helper(short=True)

    def test_existing_identity_is_preserved(self):
        self.run_helper(existing=True)

    def test_malformed_public_key_is_rejected(self):
        self.run_helper(malformed=True)


if __name__ == '__main__':
    unittest.main()
