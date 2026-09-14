import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { onRequestPost } from '../../functions/g4.js';
import { _resetGovernorForTests } from '../governor.js';

const request = (query = '') => ({ request: new Request('https://blochl1.com/g4' + query, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 17, method: 'getsupply', params: [] }),
}) });
const refusal = { code: -32601, message: 'method not found: getsupply' };
async function run(t, fetcher, query = '') {
  _resetGovernorForTests();
  t.mock.method(globalThis, 'fetch', fetcher);
  const response = await onRequestPost(request(query));
  return { response, body: await response.json() };
}
test('matching node refusals preserve their RPC code instead of reporting an outage', async t => {
  const { response, body } = await run(t, async () => Response.json({ error: refusal }));
  assert.equal(response.status, 200);
  assert.equal(body.id, 17);
  assert.deepEqual(body.error, refusal);
  assert.equal(body.corroboration.state, 'corroborated');
});
test('a pinned refusal retains the answering node and original error', async t => {
  const { response, body } = await run(t, async () => Response.json({ error: refusal }), '?node=1');
  assert.deepEqual(body.error, refusal);
  assert.equal(response.headers.get('x-bloch-node-index'), '1');
  assert.equal(response.headers.get('x-bloch-source'), 'archival');
});
test('one refusal and one outage are reported as a single-source response', async t => {
  const { body } = await run(t, async url => {
    if (url.includes('166.5')) return Response.json({ error: refusal });
    throw new Error('connection refused');
  });
  assert.deepEqual(body.error, refusal);
  assert.equal(body.corroboration.state, 'single');
});
test('HTML HTTP failures remain transport failures with the client outage code', async t => {
  const { response, body } = await run(t, async () => new Response('<html>Forbidden</html>', { status: 403 }));
  assert.equal(response.status, 502);
  assert.equal(body.error.code, -32050);
  assert.equal(body.error.message, 'no archival answered');
});
test('malformed JSON-RPC is not accepted as successful data', async t => {
  const { response, body } = await run(t, async () => Response.json({ unexpected: true }));
  assert.equal(response.status, 502);
  assert.equal(body.error.code, -32050);
});
test('a successful response remains usable when the other node refuses', async t => {
  const { body } = await run(t, async url => Response.json(url.includes('166.5') ? { result: { supply: 123 } } : { error: refusal }));
  assert.deepEqual(body.result, { supply: 123 });
  assert.equal(body.corroboration.state, 'single');
});
test('different node errors are not reported as corroborated', async t => {
  const { response, body } = await run(t, async url => Response.json({ error: url.includes('166.5') ? refusal : { code: -32602, message: 'invalid params' } }));
  assert.equal(response.status, 502);
  assert.equal(body.error.code, -32050);
  assert.equal(body.error.message, 'archival RPC errors disagree');
  assert.equal(body.corroboration.state, 'none');
});
