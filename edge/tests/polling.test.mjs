// SPDX-License-Identifier: AGPL-3.0-or-later
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { pollWhileVisible } from '../../src/lib/polling.ts';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('visible polling never overlaps and sleeps while the page is hidden', async () => {
  const originalDocument = globalThis.document;
  const listeners = new Set();
  const page = {
    visibilityState: 'visible',
    addEventListener(type, fn) { if (type === 'visibilitychange') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'visibilitychange') listeners.delete(fn); },
    visibility(value) {
      this.visibilityState = value;
      for (const fn of listeners) fn();
    },
  };
  globalThis.document = page;

  let calls = 0;
  let active = 0;
  let mostActive = 0;
  const releases = [];
  const stop = pollWhileVisible(() => {
    calls += 1;
    active += 1;
    mostActive = Math.max(mostActive, active);
    return new Promise(resolve => releases.push(() => { active -= 1; resolve(); }));
  }, 5);

  try {
    await wait(15);
    assert.equal(calls, 1, 'the interval cannot launch over a slow read');
    assert.equal(mostActive, 1);

    releases.shift()();
    await wait(10);
    assert.equal(calls, 2, 'the next interval starts after settlement');

    page.visibility('hidden');
    releases.shift()();
    await wait(15);
    assert.equal(calls, 2, 'a hidden page schedules no work');

    page.visibility('visible');
    await wait(1);
    assert.equal(calls, 3, 'returning to the page refreshes immediately');
  } finally {
    stop();
    releases.shift()?.();
    globalThis.document = originalDocument;
  }
});
