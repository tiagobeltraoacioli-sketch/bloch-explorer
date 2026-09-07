// SPDX-License-Identifier: AGPL-3.0-or-later
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../api.js';
import { handleRead, capabilitiesJson, adoptPlane, planeView } from '../core.js';
import { parsePools, poolSnapshot, MAX_POOL_SIZE } from '../pool.js';
import { methodSpec, EDGE_SURFACE } from '../surface.js';
import { ARCHIVAL_RATE, CLIENT_RATE } from '../governor.js';
import { reset, clock, fakeCache, fakeFetch, opts, chainInfo, ARCHIVALS, FLEET } from './harness.mjs';
import { decimal, count, mempoolMetrics, appendSample, transactionStatus } from '../../src/lib/observatory.ts';
import { readRpc } from '../../src/lib/rpcTransport.ts';

beforeEach(reset);
const request = (method, params = [], id = 1) => ({ jsonrpc: '2.0', id, method, params });
const healthy = (extra = {}) => Object.fromEntries([...ARCHIVALS, ...FLEET].map(url => [url, method => {
  if (method === 'getchaininfo') return { result: chainInfo() };
  if (method === 'getbuildinfo') return { result: { build_version: 'test-build', source_digest: 'aa'.repeat(32), hostname: 'DO-NOT-EXPOSE' } };
  if (method === 'gettxstatus') return { result: { status: 'pending' } };
  if (method === 'getmempoolinfo') return { result: { size: 5, max: 100, bytes: 2000 } };
  return extra[method];
}]));

test('RPC expansion is limited to two optional read-only methods', () => {
  assert.deepEqual(EDGE_SURFACE.filter(m => m.optional).map(m => m.name).sort(), ['getbuildinfo', 'gettxstatus']);
  for (const method of ['getbuildinfo', 'gettxstatus']) {
    assert.equal(methodSpec(method).cacheClass, 'node_local');
    assert.equal(methodSpec(method).corroboration, 'none');
  }
  assert.equal(methodSpec('sendrawtransaction'), null);
});

test('optional reads work across mixed versions and retain the actual source in cache', async () => {
  const responders = healthy();
  responders[ARCHIVALS[0]] = method => method === 'getchaininfo' ? { result: chainInfo() } : { error: { code: -32601, message: 'old build' } };
  const f = fakeFetch(responders), t = clock(), o = opts(f, t, fakeCache());
  const first = await handleRead(request('getbuildinfo'), o);
  assert.equal(first.body.result.build_version, 'test-build');
  assert.equal(first.corroboration.level, 'node_local');
  assert.equal(first.corroboration.source_node, 'archival-2');
  const cached = await handleRead(request('getbuildinfo'), o);
  assert.equal(cached.cacheState, 'hit');
  assert.equal(cached.corroboration.source_node, 'archival-2');
  assert.ok(f.fleet().every(c => c.method === 'getchaininfo'));
});

test('transaction status rejects malformed input without upstream traffic', async () => {
  const f = fakeFetch(healthy()), o = opts(f, clock(), fakeCache());
  for (const params of [[], ['xyz'], ['aa'.repeat(32), 1], { txid: 'aa'.repeat(32) }, [17]]) {
    assert.equal((await handleRead(request('gettxstatus', params), o)).body.error.code, -32602);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await handleApi('/api/v1/tx-status/nope', new URLSearchParams(), o)).status, 400);
  const out = await handleApi('/api/v1/tx-status/' + 'aa'.repeat(32), new URLSearchParams(), o);
  assert.equal(out.body.data.status, 'pending');
  assert.equal(out.body.corroboration.level, 'node_local');
});

test('network endpoint reports measured nodes, optional absence and actual budget constants', async () => {
  const f = fakeFetch(healthy()), t = clock();
  const before = poolSnapshot({ archivals: ARCHIVALS, fleet: FLEET }, t());
  assert.ok(before.every(n => n.status === 'unobserved'));
  const out = await handleApi('/api/v1/network', new URLSearchParams('url=http://untrusted/'), opts(f, t, fakeCache()));
  assert.equal(out.status, 200);
  assert.equal(out.body.data.pool.observers, 2);
  assert.equal(out.body.data.head.data.slot, chainInfo().slot);
  assert.equal(out.body.data.nodes.filter(n => n.role === 'observer' && n.status === 'responding').length, 2);
  assert.equal(out.body.data.capabilities.limits.upstream_calls_per_second, ARCHIVAL_RATE);
  assert.equal(capabilitiesJson(t()).limits.client_sustained_per_second, CLIENT_RATE);
  assert.ok(f.calls.every(c => [...ARCHIVALS, ...FLEET].includes(c.url)));
  assert.ok(f.fleet().every(c => c.method === 'getchaininfo'));
  const telemetry = JSON.stringify(out.body.data.nodes);
  assert.ok(!telemetry.includes('http://'));
  assert.ok(!telemetry.includes('DO-NOT-EXPOSE'));
  t.advance(61_000);
  assert.ok(poolSnapshot({ archivals: ARCHIVALS, fleet: FLEET }, t()).filter(n => n.sampled_at !== null).every(n => n.status === 'stale'));
});

test('unsupported node version leaves network telemetry available and reports a partial result', async () => {
  const f = fakeFetch(Object.fromEntries([...ARCHIVALS, ...FLEET].map(u => [u, method => method === 'getchaininfo' ? { result: chainInfo() } : undefined])));
  const out = await handleApi('/api/v1/network', new URLSearchParams(), opts(f, clock(), fakeCache()));
  assert.equal(out.status, 200);
  assert.equal(out.body.partial, true);
  assert.equal(out.body.data.build.error.code, -32601);
  assert.ok(out.body.data.head.data);
});

test('expanded pools normalize URLs, stay bounded and reject validator promotion', () => {
  assert.equal(parsePools({ EXPLORER_ARCHIVALS: 'https://observer.example https://observer.example/' }).archivals.length, 1);
  const many = Array.from({ length: MAX_POOL_SIZE }, (_, i) => `https://observer-${i}.example`).join(',');
  assert.equal(parsePools({ EXPLORER_ARCHIVALS: many }).archivals.length, MAX_POOL_SIZE);
  for (const bad of ['file:///etc/passwd', 'https://name:password@observer.example', 'http://139.84.201.52:8080/', many + ',https://overflow.example']) {
    assert.throws(() => parsePools({ EXPLORER_ARCHIVALS: bad }));
  }
  assert.throws(() => parsePools({ EXPLORER_ARCHIVALS: 'https://same.example/a', EXPLORER_FLEET: 'https://same.example/b' }));
});

test('head agreement checks every configured observer, not only the first two', () => {
  const t = clock();
  adoptPlane([chainInfo(), chainInfo(), chainInfo({ block_id: 'dd'.repeat(32) })].map(result => ({ value: { result } })), { now: t, archivals: ['a', 'b', 'c'], witness: null });
  assert.equal(planeView(t()).agree_on_head, false);
});

test('coalesced JSON-RPC reads preserve each caller id', async () => {
  const o = opts(fakeFetch(healthy()), clock(), fakeCache());
  const reads = await Promise.all(Array.from({ length: 10 }, (_, i) => handleRead(request('getchaininfo', [], i + 100), o)));
  assert.deepEqual(reads.map(r => r.body.id), Array.from({ length: 10 }, (_, i) => i + 100));
  assert.ok(reads.some(r => r.cacheState === 'coalesced'));
});

test('mempool metrics distinguish missing, zero and unsafe numbers', () => {
  assert.equal(count(-1), null); assert.equal(count('0'), null); assert.equal(count(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(decimal('18446744073709551615'), '18446744073709551615');
  assert.equal(decimal(''), null); assert.equal(decimal('1.5'), null);
  assert.equal(mempoolMetrics({ size: 0, max: 100, bytes: 0 }).occupancy, 0);
  assert.equal(mempoolMetrics({ size: 0, max: 0, bytes: 0 }).occupancy, null);
  assert.equal(mempoolMetrics({ size: 0, max: 100, bytes: 0 }).averageBytes, null);
  assert.equal(mempoolMetrics({ size: 5, max: 100, bytes: 2000 }).averageBytes, 400);
  assert.equal(mempoolMetrics({}).size, null);
});

test('session history cannot join different observers, reorgs or missing intervals', () => {
  const sample = { at: 1000, size: 3, bytes: 10, source: 'archival-1', salt: 0 };
  const history = [sample];
  assert.equal(appendSample(history, { ...sample, at: 2000 }).length, 2);
  for (const changed of [{ source: 'archival-2' }, { salt: 1 }, { at: 100000 }]) {
    assert.equal(appendSample(history, { ...sample, at: 2000, ...changed }).length, 1);
  }
  let many = [];
  for (let i = 1; i <= 150; i++) many = appendSample(many, { ...sample, at: i * 1000 });
  assert.equal(many.length, 120);
  assert.equal(transactionStatus({ status: 'unknown' }), 'unknown');
  assert.equal(transactionStatus('finalized'), 'finalized');
  assert.equal(transactionStatus({ status: 'confirmed forever' }), null);
});

test('RPC transport rejects HTML, malformed envelopes, wrong ids and failed HTTP results', async () => {
  for (const output of [() => new Response('<html>error</html>'), () => Response.json({ jsonrpc: '2.0', id: -1, result: {} }), () => Response.json([]), id => Response.json({ jsonrpc: '2.0', id, result: {} }, { status: 503 })]) {
    await assert.rejects(readRpc('getchaininfo', [], { fetchImpl: async (_, init) => output(JSON.parse(init.body).id) }));
  }
  const error = await readRpc('getchaininfo', [], { fetchImpl: async (_, init) => Response.json({ jsonrpc: '2.0', id: JSON.parse(init.body).id, error: { code: -32000, message: 'limited', data: { retry_after_ms: 500 } } }, { status: 429 }) });
  assert.equal(error.error.data.retry_after_ms, 500);
});

test('RPC transport enforces a deadline', async () => {
  await assert.rejects(readRpc('getchaininfo', [], {
    timeoutMs: 5,
    fetchImpl: async (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
  }), /timed out/);
});
