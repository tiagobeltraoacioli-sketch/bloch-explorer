// SPDX-License-Identifier: AGPL-3.0-or-later
// A bounded, read-only route to the independent archival indexer process.
import { Bucket, clientBucket, clientKey } from '../../edge/governor.js';
import { handleRead, buildOpts, runtimeFor } from '../../edge/core.js';
const budget = new Bucket(40, 15, Date.now);
const HASH = '[a-fA-F0-9]{64}';
const route = new RegExp(`^(?:health|transactions|(?:utxos|history|tx)/${HASH}|outpoint/${HASH}/[0-9]{1,10}|block/${HASH}/transactions)$`);
const origin = 'http://139.180.166.5.nip.io:8080/indexer/';
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const answer = (status, body) => new Response(JSON.stringify(body), { status, headers });
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return answer(405, { error: 'Read-only endpoint; GET required.' });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/indexer\//, '');
  if (!route.test(path)) return answer(404, { error: 'Unknown indexer endpoint.' });
  if (url.search.length > 350) return answer(400, { error: 'Query too long.' });
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) return answer(400, { error: 'Duplicate parameter.' });
    seen.add(key);
    if (key === 'limit' && /^[0-9]{1,4}$/.test(value) && +value >= 1 && +value <= 1000) continue;
    if (key === 'cursor' && /^[0-9]{1,16}-[a-f0-9]{64}-[0-9]{1,16}$/.test(value)) continue;
    if (key === 'block' && /^[a-f0-9]{64}$/.test(value)) continue;
    return answer(400, { error: 'Invalid indexer parameter.' });
  }
  if (!clientBucket(clientKey(request), Date.now).take(2) || !budget.take()) {
    return answer(429, { error: 'Read budget exceeded; retry shortly.' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const upstream = await fetch(origin + path + url.search, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (![200, 400, 404, 409, 503].includes(upstream.status) || !upstream.headers.get('content-type')?.includes('application/json')) {
      return answer(503, { error: 'Historical index unavailable.' });
    }
    const reader = upstream.body.getReader();
    let bytes = 0; const chunks = [];
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) { await reader.cancel(); return answer(502, { error: 'Indexer response exceeded its size limit.' }); }
      chunks.push(value);
    }
    const data = JSON.parse(await new Blob(chunks).text());
    if (path === 'health' && upstream.ok) {
      const observed = await handleRead({ jsonrpc: '2.0', id: 1, method: 'getchaininfo', params: [] }, { ...buildOpts(env, request, runtimeFor(context)), budgetMs: 4000 });
      const head = observed.body?.result;
      if (!head || !Number.isSafeInteger(head.slot)) return answer(503, { error: 'Unable to corroborate index freshness.' });
      data.lag_slots = Math.max(0, head.slot - data.indexed_to_slot);
      data.lag_basis = 'explorer corroborated archival head';
      data.observed_head_slot = head.slot;
      // Historical receipts remain accessible as timestamped snapshots, but
      // the UI must not label a badly lagging index as its current source.
      data.ok = data.ok && data.lag_slots <= 64;
    }
    return answer(upstream.status, data);
  } catch { return answer(503, { error: 'Historical index unavailable; retry shortly.' }); }
  finally { clearTimeout(timer); }
}
