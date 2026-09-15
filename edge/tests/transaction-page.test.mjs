import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionObservation } from '../../src/lib/transactionObservation.ts';

const reading = (status, extra = {}) => ({
  data: { status }, corroboration: { level: 'node_local', source_node: 'archival-1' },
  cache: { state: 'fresh', age_ms: 0 }, ...extra,
});

test('reported transaction status is available without any indexer result', () => {
  for (const status of ['pending', 'included', 'justified', 'finalized']) {
    const result = transactionObservation(reading(status), null);
    assert.equal(result.status, status);
    assert.equal(result.source, 'archival-1');
    assert.equal(result.stale, false);
    assert.equal(result.error, null);
  }
});

test('unknown is not interpreted as transaction failure or absence', () => {
  const result = transactionObservation(reading('unknown'), null);
  assert.equal(result.status, 'unknown');
  assert.match(result.description, /does not prove absence or failure/);
});

test('transport failure and cached stale status cannot appear as current finalization', () => {
  assert.equal(transactionObservation(reading('finalized'), 'Network unavailable').stale, true);
  assert.equal(transactionObservation(reading('finalized', { cache: { state: 'stale' } }), null).stale, true);
  const failed = transactionObservation(reading('finalized', { error: { message: 'Observer unavailable' } }), null);
  assert.equal(failed.stale, true);
  assert.equal(failed.error, 'Observer unavailable');
});

test('missing, malformed and refused responses are distinct from unknown', () => {
  assert.equal(transactionObservation(null, null).status, null);
  assert.match(transactionObservation(reading('invented'), null).error, /unrecognized/);
  const refused = transactionObservation(reading(null, { data: null, error: { code: -32601, message: 'Unsupported node version' } }), null);
  assert.equal(refused.status, null);
  assert.equal(refused.error, 'Unsupported node version');
});
