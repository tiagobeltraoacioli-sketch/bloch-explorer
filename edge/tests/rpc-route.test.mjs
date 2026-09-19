// SPDX-License-Identifier: AGPL-3.0-or-later
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  MAX_RPC_BODY_BYTES,
  onRequest,
  onRequestOptions,
  onRequestPost,
  respond,
} from '../../functions/rpc.js';

const url = 'https://blochl1.com/rpc';
const context = request => ({ request, env: {}, waitUntil() {} });
const post = (body, headers = { 'content-type': 'application/json; charset=utf-8' }) =>
  new Request(url, { method: 'POST', headers, body });

test('the RPC HTTP boundary requires JSON and bounds the streamed body', async () => {
  const media = await onRequestPost(context(post('{}', { 'content-type': 'text/plain' })));
  assert.equal(media.status, 415);
  assert.equal((await media.json()).error.data.reason, 'unsupported_media_type');

  const oversized = await onRequestPost(context(post(' '.repeat(MAX_RPC_BODY_BYTES + 1))));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.data.reason, 'body_too_large');
  assert.equal(oversized.headers.get('cache-control'), 'no-store');
  assert.equal(oversized.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(oversized.headers.get('access-control-allow-origin'), '*');
});

test('parse and internal faults remain JSON-RPC responses without leaking exception details', async t => {
  const malformed = await onRequestPost(context(post('{')));
  assert.equal(malformed.status, 200);
  assert.equal((await malformed.json()).error.code, -32700);

  t.mock.method(console, 'error', () => {});
  const request = post(JSON.stringify({ jsonrpc: '2.0', id: 19, method: 'getchaininfo', params: [] }));
  const fault = await onRequestPost({ request, env: { EXPLORER_ARCHIVALS: 'file:///private-binding' }, waitUntil() {} });
  const body = await fault.json();
  assert.equal(fault.status, 200);
  assert.equal(body.id, 19);
  assert.equal(body.error.code, -32603);
  assert.equal(body.error.data.reason, 'edge_fault');
  assert.equal(body.error.data.chainStatusKnown, false);
  assert.ok(!JSON.stringify(body).includes('private-binding'));
  assert.equal(fault.headers.get('content-type'), 'application/json; charset=utf-8');
});

test('RPC methods and provenance headers match the advertised HTTP contract', async () => {
  const preflight = await onRequestOptions();
  assert.match(preflight.headers.get('access-control-allow-methods'), /GET, POST, OPTIONS/);

  const refused = await onRequest(context(new Request(url, { method: 'PUT' })));
  assert.equal(refused.status, 405);
  assert.equal(refused.headers.get('allow'), 'GET, POST, OPTIONS');
  assert.equal((await refused.json()).error.data.reason, 'method_not_allowed');

  const response = respond({
    body: { jsonrpc: '2.0', id: 1, result: { height: 7 } },
    cacheState: 'hit',
    ageMs: 12,
    corroboration: { level: 'corroborated', cache_salt: 9 },
  });
  assert.equal(response.headers.get('x-edge-cache'), 'hit');
  assert.equal(response.headers.get('x-edge-age-ms'), '12');
  assert.equal(response.headers.get('x-edge-corroboration'), 'corroborated');
  assert.equal(response.headers.get('x-edge-salt'), '9');
});
