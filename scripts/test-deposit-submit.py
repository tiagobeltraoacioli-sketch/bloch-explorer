"""Submission guard tests using in-memory RPC responses; never touches a node."""
import contextlib, io, json, pathlib, runpy, sys, tempfile, unittest
from unittest.mock import patch
SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'public/downloads/deposit-submit.py'
DOMAIN = 'f47d3e498ff978e34471dafff5f94fe139fc3ff489b1a00f469c030258311966'
class SubmissionGuards(unittest.TestCase):
    def run_helper(self, args, active=True, domain=DOMAIN):
        calls = []
        class Client:
            def open(self, request, timeout):
                body = json.loads(request.data); calls.append(body)
                value = {'active':active,'network_domain':domain} if body['method']=='getvalidatoradmission' else {'txid':'test-only'}
                return io.BytesIO(json.dumps({'result':value}).encode())
        with patch.object(sys,'argv',[str(SCRIPT),*args]), patch('urllib.request.build_opener',return_value=Client()), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try: runpy.run_path(str(SCRIPT),run_name='__main__'); code=0
            except SystemExit as e: code=e.code
        return code,calls
    def test_default_never_broadcasts(self):
        code,calls=self.run_helper([])
        self.assertEqual(code,0); self.assertEqual([c['method'] for c in calls],['getvalidatoradmission'])
    def test_inactive_refuses_submission(self):
        code,calls=self.run_helper(['--submit'],active=False)
        self.assertEqual(code,1); self.assertEqual(len(calls),1)
    def test_wrong_network_refuses_submission(self):
        code,calls=self.run_helper(['--submit'],domain='wrong')
        self.assertEqual(code,1); self.assertEqual(len(calls),1)
    def test_external_endpoint_is_refused(self):
        code,calls=self.run_helper(['--rpc','http://example.com/','--submit'])
        self.assertEqual(code,2); self.assertEqual(calls,[])
    def test_non_deposit_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'tx.hex';p.write_text('ff00')
            code,calls=self.run_helper(['--tx',str(p),'--submit'])
        self.assertEqual(code,1);self.assertEqual(len(calls),1)
    def test_explicit_submission_passes_bytes_to_node_validation(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'tx.hex';p.write_text('0b00')
            code,calls=self.run_helper(['--tx',str(p),'--submit'])
        self.assertEqual(code,0);self.assertEqual(calls[-1]['method'],'sendrawtransaction');self.assertEqual(calls[-1]['params'],['0b00'])
if __name__ == '__main__': unittest.main()
