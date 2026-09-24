// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphusHistory, graphusNeighbors, graphusPage, graphusTransaction } from '../../src/lib/graphus.ts';

const txid = 'a'.repeat(64), previous = 'b'.repeat(64), block = 'c'.repeat(64), script = 'd'.repeat(64);
const receipt = {
  txid, block_id: block, slot: 118484, height: 89276, kind: 'transfer_v2', fee_sat: '2194',
  inputs: [{ txid: previous, vout: 1, value_sat: '391099999999993502', script_hash: script }],
  outputs: [{ vout: 0, value_sat: '391099999999991308', script_hash: script }],
  owner: 'not-an-indexer-fact',
};

test('Bloch constellation keeps exact indexed outpoint facts and no ownership claim', () => {
  const page = graphusPage({ transactions: [receipt], as_of_slot: 118484,
    source: 'archival-1 / canonical blocks.log', verification: 'consensus replay and state-root verification' });
  assert.ok(page);
  assert.deepEqual(page.transactions[0], {
    txid, blockId: block, slot: 118484, height: 89276, kind: 'transfer_v2', feeSat: '2194',
    inputs: [{ txid: previous, vout: 1, valueSat: '391099999999993502', scriptHash: script }],
    outputs: [{ txid, vout: 0, valueSat: '391099999999991308', scriptHash: script }],
  });
  assert.equal(page.asOfSlot, 118484);
  assert.equal(page.verification, 'consensus replay and state-root verification');
  assert.ok(!JSON.stringify(page).includes('not-an-indexer-fact'));
});

test('Bloch constellation refuses malformed references and amounts', () => {
  assert.equal(graphusTransaction({ ...receipt, inputs: [{ ...receipt.inputs[0], txid: 'bad' }] }), null);
  assert.equal(graphusTransaction({ ...receipt, outputs: [{ ...receipt.outputs[0], value_sat: 42 }] }), null);
  assert.equal(graphusPage({ transactions: [receipt], as_of_slot: -1, source: 'archive' }), null);
  assert.equal(graphusPage({ transactions: Array(9).fill(receipt), as_of_slot: 1, source: 'archive' }), null);
});

test('script constellation preserves created and spent events without inventing ownership', () => {
  const rawHistory = { script_hash: script, total: 2, as_of_slot: 118484,
    source: 'archival-1 / canonical blocks.log', verification: 'consensus replay and state-root verification',
    events: [
      { kind: 'created', txid, transaction_id: txid, block_id: block, vout: 0, value_sat: '391099999999993502', slot: 118400, height: 89200, owner: 'false-claim' },
      { kind: 'spent', txid, transaction_id: previous, vout: 0, value_sat: '391099999999993502', slot: 118484, height: 89276 },
    ] };
  const history = graphusHistory(rawHistory, script);
  assert.ok(history);
  assert.equal(history.events.length, 2);
  assert.equal(history.events[1].transactionId, previous);
  assert.equal(history.events[0].blockId, block);
  assert.equal(history.events[0].valueSat, '391099999999993502');
  assert.ok(!JSON.stringify(history).includes('false-claim'));
  assert.equal(graphusHistory({ ...rawHistory, script_hash: 'f'.repeat(64) }, script), null);
  assert.equal(graphusHistory({ ...rawHistory, events: [{ ...rawHistory.events[0], block_id: 'bad' }] }, script), null);
});

test('wallet reference map counts shared transactions and exact values without linking inputs to outputs', () => {
  const other = 'e'.repeat(64);
  const first = graphusTransaction({ ...receipt, outputs: [...receipt.outputs, { vout: 1, value_sat: '7', script_hash: other }] });
  const second = graphusTransaction({ ...receipt, txid: previous, outputs: [{ vout: 0, value_sat: '11', script_hash: other }] });
  assert.ok(first && second);
  assert.deepEqual(graphusNeighbors(script, [first, second]), [{
    scriptHash: other, transactions: 2, inputSat: '0', outputSat: '18',
    inputCount: 0, outputCount: 2, txids: [txid, previous],
  }]);
  assert.deepEqual(graphusNeighbors('invalid', [first]), []);
});
