import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { handleGateway, enforceReadQuorum, readBounded, resetGatewayForTests, MAX_BODY } from '../../gateway/worker.js';
import { ARCHIVALS, FLEET, clock, fakeCache, fakeFetch, chainInfo, reset } from './harness.mjs';

beforeEach(() => { reset(); resetGatewayForTests(); });
const payload = (method = 'getchaininfo', params = []) => ({ jsonrpc: '2.0', id: 7, method, params });
const req = (p = payload(), headers = {}) => new Request('https://posternlabs.com/g4rpc', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(p),
});
const env = { EXPLORER_ARCHIVALS: ARCHIVALS.join(' '), EXPLORER_FLEET: FLEET.join(' ') };
const opts = extra => ({ now: clock(), cache: fakeCache(), fetchImpl: () => { throw Error('unexpected upstream'); }, ...extra });
const call = (p, overrides = {}, headers = {}) => handleGateway(req(p, headers), env, {}, opts(overrides));
const proof = { level: 'corroborated', archival_witnesses: 2, fleet_witness: true };
const goodRead = () => ({ body: { jsonrpc: '2.0', id: 7, result: { height: 50 } }, corroboration: proof, cacheState: 'miss', status: 200 });

test('gateway capabilities identify strict reads and the separate broadcast error', async () => {
  const r = await call(payload('getcapabilities')); const v = await r.json();
  assert.equal(v.result.edge, 'bloch-g4-rpc');
  assert.equal(v.result.error_codes.no_quorum, -32051);
  assert.equal(v.result.error_codes.submission_unknown, -32052);
  assert.equal(v.result.strict_read_quorum, true);
  assert.ok(v.result.methods.some(m => m.name === 'sendrawtransaction'));
  assert.ok(!v.result.absent.some(m => m.name === 'sendrawtransaction'));
});

test('gateway answers CORS locally and preserves unrelated site routes', async () => {
  const r = await handleGateway(new Request('https://posternlabs.com/g4rpc', { method: 'OPTIONS' }));
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const other = new Request('https://posternlabs.com/g4rpc-other');
  const response = await handleGateway(other, {}, {}, { fetchImpl: input => { assert.equal(input, other); return new Response('original site'); } });
  assert.equal(await response.text(), 'original site');
});

test('gateway rejects invalid JSON-RPC, batches, notifications and non-JSON bodies before upstream', async () => {
  for (const p of [[], {}, { ...payload(), jsonrpc: '1.0' }, { method: 'getchaininfo', jsonrpc: '2.0' }, { ...payload(), params: 'bad' }, { ...payload(), id: true }]) {
    assert.equal((await call(p)).status, 400);
  }
  assert.equal((await call(payload(), {}, { 'content-type': 'text/plain' })).status, 415);
  const r = await handleGateway(new Request('https://posternlabs.com/g4rpc'));
  assert.equal(r.status, 405);
});

test('gateway bounds actual request bytes without trusting Content-Length', async () => {
  const r = await call(payload('sendrawtransaction', ['aa'.repeat(MAX_BODY)]));
  assert.equal(r.status, 413);
});

test('stream limit and slow-body deadline are enforced', async () => {
  await assert.rejects(readBounded(new Response('12345').body, 4), /body_too_large/);
  await assert.rejects(readBounded(new ReadableStream({ start() {} }), 4, 5), /body_timeout/);
});

test('strict reads never accept one observer, stale fallback or missing fleet witness', async () => {
  for (const override of [{ corroboration: { ...proof, archival_witnesses: 1 } }, { corroboration: { ...proof, fleet_witness: false } }, { corroboration: { ...proof, level: 'uncorroborated' } }, { cacheState: 'stale' }]) {
    const r = await call(payload(), { handleRead: () => ({ ...goodRead(), ...override }) });
    const v = await r.json(); assert.equal(v.error.code, -32051); assert.equal(v.result, undefined);
  }
});

test('a corroborated result carries its evidence and original id', async () => {
  const r = await call(payload(), { handleRead: goodRead }); const v = await r.json();
  assert.equal(v.id, 7); assert.equal(v.result.height, 50); assert.deepEqual(v.result.corroboration, proof);
});

test('node-local tracking is allowed but never promoted to settlement proof', () => {
  const out = { body: { result: { status: 'finalized' } }, corroboration: { level: 'node_local' } };
  assert.equal(enforceReadQuorum(out, payload('gettxstatus', ['ab'.repeat(32)])), out);
});

test('real read engine rejects disagreeing observers through the gateway', async () => {
  const map = Object.fromEntries(FLEET.map(u => [u, () => ({ result: chainInfo() })]));
  ARCHIVALS.forEach((u, i) => { map[u] = (m, p) => ({ result: m === 'getchaininfo' ? chainInfo() : { script_hash: p[0], balance_sat: String(i) } }); });
  const r = await call(payload('getbalance', ['ab'.repeat(32)]), { fetchImpl: alignedFetch(map) });
  assert.equal((await r.json()).error.code, -32051);
});

test('real read engine refuses degraded single-observer chain info', async () => {
  const map = Object.fromEntries(FLEET.map(u => [u, () => ({ result: chainInfo() })]));
  map[ARCHIVALS[0]] = () => ({ result: chainInfo() }); map[ARCHIVALS[1]] = () => 'http500';
  const r = await call(payload(), { fetchImpl: alignedFetch(map) });
  assert.equal((await r.json()).error.code, -32051);
});

test('broadcast preserves node capacity/terminal errors verbatim and never fans out', async () => {
  for (const code of [-32010, -32008, -32009]) {
    let calls = 0;
    const error = { code, message: 'node refusal', data: { retryable: code !== -32008 } };
    const r = await call(payload('sendrawtransaction', { hex: 'aabb' }), { fetchImpl: async (url, init) => {
      calls++; assert.equal(url, ARCHIVALS[0]);
      assert.deepEqual(init.headers, { 'content-type': 'application/json' });
      assert.equal(init.redirect, 'error');
      assert.deepEqual(JSON.parse(init.body).params, { hex: 'aabb' });
      return Response.json({ jsonrpc: '2.0', id: 7, error });
    } }, { Origin: 'https://wallet.example', Authorization: 'Bearer caller-only' });
    assert.equal(calls, 1); assert.deepEqual((await r.json()).error, error);
  }
});

test('broadcast transport failure reports uncertainty and does not retry', async () => {
  let calls = 0;
  const r = await call(payload('sendrawtransaction', ['aabb']), { fetchImpl: async () => { calls++; throw Error('connection reset'); } });
  const v = await r.json(); assert.equal(calls, 1); assert.equal(v.error.code, -32052);
  assert.equal(v.error.data.admission_unknown, true);
});

test('malformed upstream responses cannot be reported as a successful broadcast', async () => {
  for (const value of [{ jsonrpc: '2.0', id: 8, result: {} }, { jsonrpc: '2.0', id: 7 }, { jsonrpc: '2.0', id: 7, result: {}, error: {} }]) {
    const r = await call(payload('sendrawtransaction', ['aabb']), { fetchImpl: async () => Response.json(value) });
    assert.equal((await r.json()).error.code, -32052);
  }
});

test('unknown methods and invalid transaction encoding do not reach an upstream', async () => {
  assert.equal((await (await call(payload('not_a_method'))).json()).error.code, -32601);
  for (const raw of ['', 'a', 'zz']) assert.equal((await call(payload('sendrawtransaction', [raw]))).status, 400);
});

test('broadcast rate limits enforce the documented two-per-second refill', async () => {
  const now = clock(); let calls = 0;
  const overrides = { now, fetchImpl: async () => { calls++; return Response.json({ jsonrpc: '2.0', id: 7, result: { accepted: true } }); } };
  for (let i = 0; i < 4; i++) assert.equal((await call(payload('sendrawtransaction', ['aa']), overrides)).status, 200);
  assert.equal((await call(payload('sendrawtransaction', ['aa']), overrides)).status, 429);
  now.advance(499); assert.equal((await call(payload('sendrawtransaction', ['aa']), overrides)).status, 429);
  now.advance(1); assert.equal((await call(payload('sendrawtransaction', ['aa']), overrides)).status, 200);
  assert.equal(calls, 5);
});

test('real read engine serves agreeing observers with fresh fleet evidence', async () => {
  const map = Object.fromEntries([...FLEET, ...ARCHIVALS].map(u => [u, () => ({ result: chainInfo() })]));
  const r = await call(payload(), { fetchImpl: alignedFetch(map) });
  const v = await r.json(); assert.equal(v.result.corroboration.level, 'corroborated');
  assert.equal(v.result.corroboration.archival_witnesses, 2);
});

test('broadcast rejects redirects and oversized replies without retrying', async () => {
  for (const response of [new Response('', { status: 302 }), new Response('x'.repeat(2 * MAX_BODY + 1))]) {
    let calls = 0;
    const r = await call(payload('sendrawtransaction', ['aa']), { fetchImpl: async () => { calls++; return response; } });
    assert.equal((await r.json()).error.code, -32052); assert.equal(calls, 1);
  }
});

test('broadcast allows at most two concurrent upstream attempts', async () => {
  const releases = []; let calls = 0;
  const overrides = { fetchImpl: () => { calls++; return new Promise(resolve => releases.push(() => resolve(Response.json({ jsonrpc: '2.0', id: 7, result: {} })))); } };
  const first = call(payload('sendrawtransaction', ['aa']), overrides);
  const second = call(payload('sendrawtransaction', ['aa']), overrides);
  while (calls < 2) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await call(payload('sendrawtransaction', ['aa']), overrides)).status, 429);
  releases.forEach(resolve => resolve());
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
});

function alignedFetch(map) {
  const fake = fakeFetch(map);
  return async (url, init) => {
    const r = await fake(url, init);
    return { ...r, text: async () => {
      const text = await r.text(); if (!text) return text;
      const v = JSON.parse(text); v.id = JSON.parse(init.body).id;
      return JSON.stringify(v);
    } };
  };
}

test('read responses with a wrong id are rejected and redirects are disabled', async () => {
  let calls = 0;
  const r = await call(payload(), { fetchImpl: async (_url, init) => {
    calls++; assert.equal(init.redirect, 'error');
    return Response.json({ jsonrpc: '2.0', id: 'wrong-id', result: chainInfo() });
  } });
  assert.ok(calls > 0); assert.ok((await r.json()).error);
});
