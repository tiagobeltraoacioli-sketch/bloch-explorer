import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedTransaction, IndexedTxAmbiguity, receiptConservation } from '../../src/lib/indexer.ts';

const txid = 'a'.repeat(64);
const io = value_sat => ({ value_sat, vout: 0, script_hash: 'b'.repeat(64) });
const tx = { txid, block_id: 'c'.repeat(64), slot: 12, height: 9, index: 0, kind: 'transfer', size_bytes: 1200, inputs: [io('9007199254740993123')], outputs: [io('9007199254740993100')], fee_sat: '23' };

test('receipt conservation keeps amounts beyond safe JS integers exact', () => {
  assert.equal(receiptConservation(tx), 'balanced');
  assert.equal(receiptConservation({ ...tx, fee_sat: '24' }), 'mismatch');
  assert.equal(receiptConservation({ ...tx, fee_sat: '3', stake_sat: '20' }), 'balanced');
});

test('missing or malformed amounts are unavailable, never conservation mismatches', () => {
  for (const patch of [{ fee_sat: null }, { stake_sat: 'bad' }, { inputs: [io('invalid')] }, { outputs: [io(12)] }]) {
    assert.equal(receiptConservation({ ...tx, ...patch }), 'unavailable');
  }
});

test('lookup distinguishes missing, unavailable, malformed and ambiguous receipts', async t => {
  let status = 200, body = tx;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }));
  assert.deepEqual(await indexedTransaction(txid), tx);
  status = 404;
  assert.equal(await indexedTransaction(txid), null);
  status = 503;
  await assert.rejects(indexedTransaction(txid), /unavailable/);
  status = 200; body = {};
  await assert.rejects(indexedTransaction(txid), /invalid transaction/);
  body = { ...tx, txid: 'd'.repeat(64) };
  await assert.rejects(indexedTransaction(txid), /invalid transaction/);
  status = 409; body = { matches: [tx, { ...tx, slot: 13 }] };
  await assert.rejects(indexedTransaction(txid), e => e instanceof IndexedTxAmbiguity && e.matches.length === 2);
  body = { matches: [{}] };
  await assert.rejects(indexedTransaction(txid), /snapshot changed/);
});
