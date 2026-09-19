import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attemptOne } from '../pool.js';
import { cacheSecondsFor } from '../../functions/g4/slots.js';

const request = { jsonrpc: '2.0', id: 41, method: 'getchaininfo', params: [] };

test('archival transport rejects a response for another JSON-RPC request', async () => {
  const wrongId = await attemptOne(
    'https://observer.invalid/',
    request,
    1_000,
    async () => Response.json({ jsonrpc: '2.0', id: 40, result: { slot: 10 } }),
  );
  assert.equal(wrongId.settled, false);
  assert.equal(wrongId.outcome, 'invalid json-rpc envelope');

  const bothBranches = await attemptOne(
    'https://observer.invalid/',
    request,
    1_000,
    async () => Response.json({ jsonrpc: '2.0', id: 41, result: {}, error: { code: -1, message: 'wrong' } }),
  );
  assert.equal(bothBranches.settled, false);
  assert.equal(bothBranches.outcome, 'invalid json-rpc envelope');
});

test('slot windows never long-cache unreadable or not-yet-final absent slots', () => {
  const head = { slots_per_epoch: 32, finalized: { epoch: 100 } };
  assert.equal(cacheSecondsFor([
    { slot: 3198, present: true, finalized: true },
    { slot: 3199, present: false },
  ], head), 600);
  assert.equal(cacheSecondsFor([
    { slot: 3199, present: false, unreadable: 'timeout' },
  ], head), 30);
  assert.equal(cacheSecondsFor([
    { slot: 3200, present: false },
  ], head), 30, 'an empty slot in the finalized checkpoint epoch is kept live conservatively');
  assert.equal(cacheSecondsFor([
    { slot: 3199, present: true, finalized: false },
  ], head), 30);
});
