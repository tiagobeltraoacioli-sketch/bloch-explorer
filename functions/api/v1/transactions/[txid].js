// SPDX-License-Identifier: AGPL-3.0-or-later
import { transactionDetails, TRANSACTION_DEADLINE_MS } from '../../../../edge/transaction.js';
import { buildOpts, runtimeFor } from '../../../../edge/core.js';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'retry-after, x-request-id, x-lookup-budget-ms',
  'x-content-type-options': 'nosniff',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  if (context.request.method !== 'GET') return new Response(JSON.stringify({ error: 'GET required' }), { status: 405, headers: HEADERS });
  const txid = context.params.txid;
  const opts = buildOpts(context.env, context.request, runtimeFor(context));
  const out = await transactionDetails(txid, opts);
  return new Response(JSON.stringify(out.body), { status: out.status, headers: {
    ...HEADERS, ...out.headers, 'x-request-id': crypto.randomUUID(),
    'x-lookup-budget-ms': String(TRANSACTION_DEADLINE_MS),
  } });
}
