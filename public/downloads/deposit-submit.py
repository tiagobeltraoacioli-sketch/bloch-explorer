#!/usr/bin/env python3
"""Read admission from a loopback node; broadcast an already signed file only with --submit."""
import argparse, json, pathlib, urllib.request, urllib.parse, sys
DOMAIN = 'f47d3e498ff978e34471dafff5f94fe139fc3ff489b1a00f469c030258311966'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--rpc', default='http://127.0.0.1:16400/')
p.add_argument('--tx', type=pathlib.Path)
p.add_argument('--submit', action='store_true', help='Broadcast the reviewed, signed deposit; this commits funds if included.')
a = p.parse_args()
u = urllib.parse.urlparse(a.rpc)
if u.scheme != 'http' or u.hostname not in ('127.0.0.1', 'localhost', '::1') or u.username or u.password:
    p.error('Use your own loopback RPC, optionally reached through an SSH tunnel.')
# Do not route a local transaction through environment-configured HTTP proxies.
client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def rpc(method, params):
    req = urllib.request.Request(a.rpc, data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(), headers={'Content-Type':'application/json'})
    with client.open(req, timeout=30) as response: body = json.load(response)
    if 'error' in body: raise RuntimeError(str(body['error']))
    return body['result']
try:
    admission = rpc('getvalidatoradmission', [])
    if admission.get('network_domain') != DOMAIN: raise RuntimeError('Wrong network domain.')
    print(json.dumps(admission, indent=2))
    if not a.submit:
        print('Read-only preflight. No transaction sent.')
        sys.exit(0)
    if not admission.get('active'): raise RuntimeError('Admission is not active on this node.')
    if not a.tx: p.error('--submit requires --tx ready.hex')
    if a.tx.stat().st_size > 262144: raise RuntimeError('Transaction file is unexpectedly large.')
    raw = a.tx.read_text().strip()
    decoded = bytes.fromhex(raw)
    if not decoded or decoded[0] != 0x0b: raise RuntimeError('Expected a funded validator deposit (0x0b).')
    print(json.dumps({'submission':rpc('sendrawtransaction', [raw])}, indent=2))
    print('Submission is not finalization. Track the returned transaction ID and validator key hash.')
except (OSError, ValueError, KeyError, RuntimeError) as e:
    print('Stopped: '+str(e), file=sys.stderr)
    sys.exit(1)
