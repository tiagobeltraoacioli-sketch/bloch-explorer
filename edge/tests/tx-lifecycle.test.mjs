// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendTxLifecycleEvent } from '../../src/lib/txLifecycle.ts';

test('transaction lifecycle stores only changed fresh observations', () => {
  const pending = { status: 'pending', at: 1000, source: 'observer-a', cacheSalt: 0 };
  const once = appendTxLifecycleEvent([], pending);
  assert.equal(appendTxLifecycleEvent(once, { ...pending, at: 2000 }), once);
  const included = appendTxLifecycleEvent(once, { ...pending, status: 'included', at: 3000 });
  assert.deepEqual(included.map(event => event.status), ['pending', 'included']);
  const changedObserver = appendTxLifecycleEvent(included, { status: 'unknown', at: 4000, source: 'observer-b', cacheSalt: 0 });
  assert.equal(changedObserver.length, 3);
  assert.equal(changedObserver[2].source, 'observer-b');
});
