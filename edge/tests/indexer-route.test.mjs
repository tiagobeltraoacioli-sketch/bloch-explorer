import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../../functions/indexer/[[path]].js';
const hash = 'ab'.repeat(32);
function ctx(path, method = 'GET') { return { request: new Request(`https://blochl1.com/indexer/${path}`, { method }), env: {}, waitUntil() {} }; }
test('indexer route rejects writes, unknown paths and malformed pagination without forwarding', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('unexpected upstream request'); };
  try {
    for (const [path, method, status] of [
      ['transactions', 'POST', 405], ['admin', 'GET', 404],
      [`utxos/${hash}?limit=0`, 'GET', 400], [`utxos/${hash}?limit=1001`, 'GET', 400],
      ['transactions?url=http://localhost', 'GET', 400], ['transactions?cursor=bad', 'GET', 400],
      ['transactions?limit=5&limit=10', 'GET', 400],
    ]) assert.equal((await onRequest(ctx(path, method))).status, status);
  } finally { globalThis.fetch = old; }
});
test('indexer route preserves exact amounts and only uses its fixed read origin', async () => {
  const old = globalThis.fetch; let target;
  globalThis.fetch = async url => { target = url; return Response.json({ transactions: [{ fee_sat: '9007199254740993' }], next_cursor: null, as_of_slot: 10 }); };
  try {
    const response = await onRequest(ctx('transactions?limit=5'));
    assert.equal(response.status, 200);
    assert.equal(target, 'http://139.180.166.5.nip.io:8080/indexer/transactions?limit=5');
    assert.equal((await response.json()).transactions[0].fee_sat, '9007199254740993');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { globalThis.fetch = old; }
});
test('indexer route fails closed on HTML and preserves a reorg conflict', async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>not an index</html>');
    assert.equal((await onRequest(ctx('transactions'))).status, 503);
    globalThis.fetch = async () => Response.json({ error: 'snapshot reorganized' }, { status: 409 });
    assert.equal((await onRequest(ctx('transactions'))).status, 409);
  } finally { globalThis.fetch = old; }
});
