import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transactionDetails, _resetTransactionForTests, MAX_RECEIPT_BYTES } from '../transaction.js';
import { onRequest } from '../../functions/api/v1/transactions/[txid].js';
import { reset, opts, fakeCache, fakeFetch, chainInfo, clock, ARCHIVALS, FLEET } from './harness.mjs';

const txid = 'ab'.repeat(32), block = 'cd'.repeat(32), tip = 'ef'.repeat(32);
const input = (over = {}) => ({ txid: '12'.repeat(32), vout: 0,
  value_sat: '9007199254740994', script_hash: '34'.repeat(32), ...over });
const output = (over = {}) => ({ vout: 0, value_sat: '9007199254740993',
  script_hash: '56'.repeat(32), ...over });
const receipt = (over = {}) => ({ txid, block_id: block, chain_tip: tip, height: 80, slot: 100,
  as_of_height: 100, as_of_slot: 120, inputs: [input()], outputs: [output()], ...over });
const head = (over = {}, level = 'corroborated') => ({ status: 200, body: {
  data: { height: 100, slot: 120, finalized_height: 90, block_id: tip, ...over }, corroboration: { level },
} });
const options = (over = {}) => ({ now: Date.now, clientKey: 'p2b-test', budgetMs: 500, ...over });
const never = () => new Promise(() => {});
const lookup = (r = receipt(), h = head(), o = options()) => transactionDetails(txid, o,
  async () => Response.json(r), async () => h);
beforeEach(() => { reset(); _resetTransactionForTests(); });

test('finalized receipts preserve exact amounts and inclusive confirmations', async () => {
  const out = await lookup();
  assert.equal(out.status, 200); assert.equal(out.body.status, 'finalized');
  assert.equal(out.body.confirmations, 21); assert.equal(out.body.outputs[0].value_sat, '9007199254740993');
  const pending = await lookup(receipt({ height: 95 }), head());
  assert.equal(pending.body.finalized, false); assert.equal(pending.body.status, 'confirmed');
});

test('the captured public receipt retains its schema and rederived status under the captured head', async () => {
  const captured = JSON.parse(readFileSync(new URL('./fixtures/p2b-public-receipt-20260930.json', import.meta.url)));
  assert.equal(captured.receipt_source.http_status, 200);
  assert.equal(captured.head_source.http_status, 200);
  const upstream = { ...captured.receipt };
  // The fixture is an actual public REST response. Strip only edge-derived
  // fields to replay its indexer data; finality is recomputed in this offline test.
  for (const field of ['confirmations', 'status', 'finalized', 'finalized_height',
    'observed_head_height', 'observed_head_slot', 'corroboration']) delete upstream[field];
  const result = captured.head_response.result;
  const finalityResponse = { status: 200, body: { data: result, corroboration: result.corroboration } };
  const out = await transactionDetails(upstream.txid, options(), async () => Response.json(upstream),
    async () => finalityResponse);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, captured.receipt);
});

test('cache-behind-index race refreshes once under the same deadline', async () => {
  const seen = [], cache = {};
  const out = await transactionDetails(txid, options({ cache }), async () => Response.json(receipt()),
    async (path, params, o) => { seen.push(o); return seen.length === 1 ? head({ height: 99, slot: 119 }) : head(); });
  assert.equal(out.status, 200); assert.equal(seen.length, 2);
  assert.equal(seen[0].cache, cache); assert.equal(seen[1].cache, null);
  assert.equal(seen[0].deadlineAt, seen[1].deadlineAt);
});

test('a second behind head is refused without repeated retries', async () => {
  let reads = 0;
  const out = await transactionDetails(txid, options(), async () => Response.json(receipt()),
    async () => { reads++; return head({ height: 99, slot: 119 }); });
  assert.equal(reads, 2); assert.equal(out.status, 503); assert.equal(out.body.code, 'FINALITY_UNAVAILABLE');
});

test('uncorroborated, missing, stale-index and contradictory finality remain unavailable', async () => {
  for (const h of [head({}, 'uncorroborated'), head({}, 'node_local'), { status: 503 },
    head({ height: 104, slot: 124 }), head({ finalized_height: 101 }), head({ finalized_height: -1 })]) {
    const out = await lookup(receipt(), h);
    assert.equal(out.status, 503); assert.equal(out.body.code, 'FINALITY_UNAVAILABLE');
    assert.equal(out.body.finalized, undefined); assert.equal(out.headers['retry-after'], '2');
  }
  const mismatch = await lookup(receipt(), head({ block_id: block }));
  assert.equal(mismatch.body.code, 'INDEX_LINEAGE_MISMATCH');
});

test('malformed receipt anchors cannot yield a creditable success', async () => {
  for (const changes of [{ txid: tip }, { txid: 42 }, { block_id: 'bad' }, { chain_tip: null }, { height: -1 },
    { height: 101 }, { slot: 121 }, { as_of_height: 2 ** 54 }, { outputs: null }]) {
    assert.equal((await lookup(receipt(changes))).body.code, 'INDEX_RECEIPT_INVALID');
  }
});

async function assertInvalidReceipt(r, label) {
  // Each case is a new admitted request, independent of the route's rate limit.
  _resetTransactionForTests();
  let headReads = 0;
  const out = await transactionDetails(txid, options(), async () => Response.json(r),
    async () => { headReads++; return head(); });
  assert.equal(out.status, 503, label);
  assert.equal(out.body.code, 'INDEX_RECEIPT_INVALID', label);
  assert.equal(out.body.finalized, undefined, label);
  assert.equal(out.body.outputs, undefined, label);
  assert.equal(out.headers['retry-after'], '2', label);
  assert.equal(headReads, 0, label + ': invalid receipts must not spend a finality read');
}

test('malformed financial rows fail closed before consulting finality', async () => {
  for (const side of ['inputs', 'outputs']) {
    const row = side === 'inputs' ? input : output;
    for (const value of [null, true, 'row', [], {}, row({ value_sat: 1.25, script_hash: 'bad' }),
      row({ value_sat: '-1' })]) {
      await assertInvalidReceipt(receipt({ [side]: [value] }), side + ': ' + JSON.stringify(value));
    }
    for (const value_sat of [null, 0, 1.25, true, [], {}, '', '-1', '+1', '1.0', '1e3',
      ' 1', '1 ', '00', '01', '18446744073709551616', '9'.repeat(100_000)]) {
      await assertInvalidReceipt(receipt({ [side]: [row({ value_sat })] }), side + ': invalid decimal');
    }
    for (const vout of [null, '0', -1, 0.5, 0x1_0000_0000, Number.MAX_SAFE_INTEGER + 1]) {
      await assertInvalidReceipt(receipt({ [side]: [row({ vout })] }), side + ': invalid vout');
    }
    for (const script_hash of [null, 42, [], 'bad', '0x' + '12'.repeat(32), '12'.repeat(31), 'gg'.repeat(32)]) {
      await assertInvalidReceipt(receipt({ [side]: [row({ script_hash })] }), side + ': invalid script hash');
    }
    for (const key of ['value_sat', 'vout', 'script_hash']) {
      const incomplete = row(); delete incomplete[key];
      await assertInvalidReceipt(receipt({ [side]: [incomplete] }), side + ': missing ' + key);
    }
  }
});

test('outpoints are typed, unique, and output identifiers bind to the receipt', async () => {
  for (const badId of [null, 42, 'bad', '0x' + txid, 'zz'.repeat(32)]) {
    await assertInvalidReceipt(receipt({ inputs: [input({ txid: badId })] }), 'invalid input txid');
    await assertInvalidReceipt(receipt({ outputs: [output({ txid: badId })] }), 'invalid output txid');
  }
  const noInputId = input(); delete noInputId.txid;
  await assertInvalidReceipt(receipt({ inputs: [noInputId] }), 'missing input outpoint txid');
  await assertInvalidReceipt(receipt({ outputs: [output({ txid: tip })] }), 'foreign output txid');
  const duplicate = input({ txid: 'ab'.repeat(32) });
  await assertInvalidReceipt(receipt({ inputs: [duplicate, { ...duplicate, txid: duplicate.txid.toUpperCase() }] }),
    'duplicate input outpoint, including mixed case');
  await assertInvalidReceipt(receipt({ outputs: [output(), output()] }), 'duplicate output vout');
  await assertInvalidReceipt(receipt({ outputs: [output({ vout: 1 })] }), 'nonsequential output vout');
});

test('exact u64 IO amounts and u128 aggregate boundaries are retained', async () => {
  const u64 = '18446744073709551615', u128 = '340282366920938463463374607431768211455';
  for (const value_sat of ['0', '9007199254740993', u64]) {
    const r = receipt({ inputs: [input({ vout: 0xffff_ffff, value_sat })],
      outputs: [output({ txid: txid.toUpperCase(), value_sat })], fee_sat: u128, stake_sat: u128,
      index: 0xffff_ffff, size_bytes: Number.MAX_SAFE_INTEGER, kind: 'unknown_255' });
    const out = await lookup(r);
    assert.equal(out.status, 200); assert.equal(out.body.finalized, true);
    assert.equal(out.body.inputs[0].value_sat, value_sat); assert.equal(out.body.outputs[0].value_sat, value_sat);
    assert.equal(out.body.fee_sat, u128); assert.equal(out.body.stake_sat, u128);
  }
  for (const r of [receipt({ inputs: [], outputs: [], fee_sat: null }),
    receipt({ fee_sat: '0', stake_sat: '0' }), receipt()]) {
    assert.equal((await lookup(r)).status, 200, 'empty sides, unknown fees and omitted auxiliary fields remain valid');
  }
});

test('supplied fee, stake and transaction metadata cannot bypass validation', async () => {
  for (const field of ['fee_sat', 'stake_sat']) {
    for (const value of [0, true, '', '-1', '00', '1.1', '340282366920938463463374607431768211456']) {
      await assertInvalidReceipt(receipt({ [field]: value }), field + ': invalid u128');
    }
  }
  for (const changes of [{ stake_sat: null }, { index: -1 }, { index: 0x1_0000_0000 },
    { index: '0' }, { size_bytes: -1 }, { size_bytes: 0.5 }, { size_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { kind: '' }, { kind: null }, { kind: 1 }]) {
    await assertInvalidReceipt(receipt(changes), 'invalid auxiliary metadata');
  }
});

test('one hard deadline covers stalled fetch, receipt body, head and refresh', async () => {
  for (const phase of ['fetch', 'body', 'head', 'refresh']) {
    let signal, calls = 0, cancelled = false;
    const start = performance.now();
    const out = await transactionDetails(txid, options({ budgetMs: 35 }), async (url, init) => {
      signal = init.signal;
      if (phase === 'fetch') return never();
      if (phase === 'body') return new Response(new ReadableStream({ cancel() { cancelled = true; } }),
        { headers: { 'content-type': 'application/json' } });
      return Response.json(receipt());
    }, async () => {
      calls++;
      if (phase === 'head' || phase === 'refresh' && calls === 2) return never();
      return phase === 'refresh' ? head({ height: 99, slot: 119 }) : head();
    });
    assert.equal(out.status, 503, phase); assert.equal(out.body.code, 'LOOKUP_DEADLINE_EXCEEDED', phase);
    assert.ok(performance.now() - start < 700, phase + ' must not wait for an ignored abort');
    assert.equal(signal.aborted, true); if (phase === 'body') assert.equal(cancelled, true);
  }
});

test('deadline propagates cancellation to finality RPC calls', async () => {
  let rpcSignal;
  const out = await transactionDetails(txid, options({ budgetMs: 30, fetchImpl: async (url, init) => {
    rpcSignal = init.signal; return never();
  } }), async () => Response.json(receipt()), async (path, params, o) => {
    return o.fetchImpl('https://observer/', { signal: new AbortController().signal });
  });
  assert.equal(out.body.code, 'LOOKUP_DEADLINE_EXCEEDED'); assert.equal(rpcSignal.aborted, true);
});

test('oversized, invalid JSON and redirected receipts fail closed', async () => {
  for (const response of [new Response('x'.repeat(MAX_RECEIPT_BYTES + 1), { headers: { 'content-type': 'application/json' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response('', { status: 302 }), new Response('<html>bad gateway</html>')]) {
    assert.equal((await transactionDetails(txid, options(), async () => response, async () => head())).status, 503);
  }
});

test('missing transactions return promptly without spending a finality read', async () => {
  const out = await transactionDetails(txid, options(), async () => new Response('', { status: 404 }),
    () => assert.fail('an unindexed tx must not consume a head read'));
  assert.equal(out.status, 404); assert.equal(out.body.code, 'TX_NOT_INDEXED');
  assert.equal(out.body.retryable, false); assert.match(out.body.error, /pending status is unknown/);
});

test('core read throttling retains HTTP 429 and explicit retry guidance', async () => {
  const out = await lookup(receipt(), { status: 429 });
  assert.equal(out.status, 429); assert.equal(out.body.code, 'FINALITY_RATE_LIMITED');
  assert.equal(out.headers['retry-after'], '1');
});

test('overlapping same-client reads coalesce but completed finality is never reused', async () => {
  let calls = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const fetch = async () => { calls++; await barrier; return Response.json(receipt()); };
  const pending = Array.from({ length: 12 }, () => transactionDetails(txid, options(), fetch, async () => head()));
  release(); const results = await Promise.all(pending);
  assert.ok(results.every(r => r.status === 200)); assert.equal(calls, 1);
  const after = await transactionDetails(txid, options(), fetch, async () => head({ finalized_height: 70 }));
  assert.equal(after.body.finalized, false); assert.equal(calls, 2);
});

test('distinct in-flight reads are bounded and expired requests release their slots', async () => {
  const pending = Array.from({ length: 16 }, (_, i) => transactionDetails(i.toString(16).padStart(64, '0'),
    options({ budgetMs: 30 }), never, never));
  const busy = await lookup();
  assert.equal(busy.status, 429); assert.equal(busy.body.code, 'LOOKUP_BUSY');
  assert.equal(busy.headers['retry-after'], '1');
  await Promise.all(pending);
  assert.equal((await lookup()).status, 200);
});

test('request admission includes coalesced calls and invalid ids never contact upstream', async () => {
  const bad = await transactionDetails('../bad', options(), () => assert.fail('must not fetch'));
  assert.equal(bad.status, 400);
  const pending = Array.from({ length: 41 }, () => transactionDetails(txid, options({ budgetMs: 30 }), never, never));
  const results = await Promise.all(pending);
  assert.ok(results.some(r => r.status === 429 && r.body.code === 'LOOKUP_RATE_LIMITED'));
});

test('actual corroboration engine recovers a warm cache in a recycled isolate', async () => {
  const now = clock(), cache = fakeCache(), chain = chainInfo();
  const rpc = fakeFetch(Object.fromEntries([...ARCHIVALS, ...FLEET].map(url => [url, { result: chain }])));
  const o = opts(rpc, now, cache);
  const index = async () => Response.json(receipt({ height: chain.height - 100, slot: chain.slot - 100,
    as_of_height: chain.height, as_of_slot: chain.slot, chain_tip: chain.block_id }));
  assert.equal((await transactionDetails(txid, o, index)).status, 200);
  const { _resetCoreForTests } = await import('../core.js'); _resetCoreForTests();
  assert.equal((await transactionDetails(txid, o, index)).status, 200);
});

test('HTTP route exposes correlation, deadline and retry headers, with no response caching', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  try {
    const ctx = { request: new Request('https://blochl1.com/api/v1/transactions/' + txid), params: { txid }, env: {}, waitUntil() {} };
    const response = await onRequest(ctx);
    assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '2');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-lookup-budget-ms'), '10000');
    assert.match(response.headers.get('x-request-id'), /^[\da-f-]{36}$/);
    assert.match(response.headers.get('access-control-expose-headers'), /retry-after/);
    assert.equal((await onRequest({ ...ctx, request: new Request(ctx.request.url, { method: 'POST' }) })).status, 405);
    assert.equal((await onRequest({ ...ctx, request: new Request(ctx.request.url, { method: 'OPTIONS' }) })).status, 204);
  } finally { globalThis.fetch = original; }
});

test('HTTP route refuses a malformed financial receipt without reading finality or echoing the payload', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async url => {
    requests++;
    assert.equal(url, 'http://139.180.166.5.nip.io:8080/indexer/tx/' + txid);
    return Response.json(receipt({ outputs: [output({ value_sat: '-1' })] }));
  };
  try {
    const response = await onRequest({
      request: new Request('https://blochl1.com/api/v1/transactions/' + txid),
      params: { txid }, env: {}, waitUntil() {},
    });
    assert.equal(requests, 1);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('retry-after'), '2');
    assert.deepEqual(await response.json(), {
      error: 'Historical transaction receipt is invalid or incomplete',
      code: 'INDEX_RECEIPT_INVALID', retryable: true,
    });
  } finally { globalThis.fetch = original; }
});
