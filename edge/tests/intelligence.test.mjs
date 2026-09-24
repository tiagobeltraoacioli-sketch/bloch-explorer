// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpaceSeries, parseReceiptSample, receiptGraph, clusterReceipts, evaluateSeries } from '../../src/lib/intelligence.ts';
import { onRequest } from '../../functions/research.js';

const hash = n => n.toString(16).padStart(64, '0');
const receipt = n => ({ txid: hash(n + 1), block_id: hash(n + 100), slot: n, height: n, kind: 'transfer', fee_sat: '2194',
  inputs: [{ txid: hash(999), vout: 0, value_sat: '391099999999993502', script_hash: hash(33) }],
  outputs: [{ vout: 0, value_sat: '391099999999991308', script_hash: hash(44) }] });
const sample = n => parseReceiptSample({ transactions: Array.from({ length: n }, (_, i) => receipt(i)), as_of_slot: n, source: 'archive', next_cursor: null });
const series = n => Array.from({ length: n }, (_, i) => ({ at: 1790000000000 + i * 900000, connections: 1000 + i * 2 + Math.sin(i) * 4, reportingNodes: 10 }));

test('series rejects malformed timing, missing coverage and wrong period without filling gaps', () => {
  const points = series(40).map(p => ({ at: p.at, connections: Math.round(p.connections), reporting_nodes: p.reportingNodes }));
  const envelope = { network: 'bloch', period: '24h', source: 'public telemetry', retrieved_at: '2026-09-24T12:00:00Z', points };
  assert.equal(parseSpaceSeries(envelope, '24h').points.length, 40);
  points[9] = { ...points[9], connections: null, reporting_nodes: null };
  assert.equal(parseSpaceSeries(envelope, '24h').points[9].connections, null);
  assert.equal(parseSpaceSeries(envelope, '6h'), null);
  points[9].reporting_nodes = 10; assert.equal(parseSpaceSeries(envelope, '24h'), null);
  points[9] = { ...points[8] }; assert.equal(parseSpaceSeries(envelope, '24h'), null);
});

test('receipt graph preserves exact outpoint identity, direction and monetary strings', () => {
  const data = sample(2); assert.ok(data);
  const graph = receiptGraph(data.transactions, 'outpoints');
  const input = graph.nodes.find(n => n.id === `o:${hash(999)}:0`);
  assert.ok(input.detail.includes('391,099,999,999,993,502'));
  assert.equal(graph.edges.filter(e => e.source === input.id).length, 2);
  assert.equal(graph.edges.filter(e => e.kind === 'creates').length, 2);
  assert.ok(graph.edges.every(e => graph.nodes.some(n => n.id === e.source) && graph.nodes.some(n => n.id === e.target)));
  assert.equal(parseReceiptSample({ transactions: [receipt(0), receipt(0)], as_of_slot: 3, source: 'x' }), null);
});

test('large graph rendering stays bounded and reports omitted records', () => {
  const data = sample(48);
  data.transactions.forEach((tx, i) => { tx.outputs = Array.from({ length: 100 }, (_, j) => ({ txid: tx.txid, vout: j, valueSat: '1', scriptHash: hash(10000 + i * 100 + j) })); });
  for (const mode of ['outpoints', 'scripts']) { const graph = receiptGraph(data.transactions, mode); assert.ok(graph.nodes.length <= 650); assert.ok(graph.edges.length <= 1600); assert.ok(graph.omitted > 0); }
});

test('walk-forward predictions cannot see future observations', () => {
  const points = series(90), before = evaluateSeries(points);
  const changed = points.map((p, i) => ({ ...p, connections: i > 60 ? p.connections + 100000 : p.connections }));
  const after = evaluateSeries(changed);
  assert.deepEqual(before.predictions.filter(p => p.index <= 60), after.predictions.filter(p => p.index <= 60));
  assert.ok(Number.isFinite(before.mae) && Number.isFinite(before.baselineMae));
  assert.ok(before.predictions.every(p => p.baseline === points[p.index - 1].connections));
  assert.equal(before.predictions[0].index, 27);
});

test('models exclude missing buckets and reporter transitions; constant baseline skill is undefined', () => {
  const points = series(90); points[40] = { ...points[40], connections: null, reportingNodes: null }; points[50].reportingNodes = 9;
  const result = evaluateSeries(points);
  for (const i of [40, 41, 42, 43, 50, 51, 52, 53]) assert.ok(!result.predictions.some(p => p.index === i));
  assert.equal(evaluateSeries(series(20)), null);
  const constant = evaluateSeries(series(60).map(p => ({ ...p, connections: 0 })));
  assert.equal(constant.mae, 0); assert.equal(constant.baselineMae, 0); assert.equal(constant.skill, null); assert.equal(constant.next, 0);
});

test('clustering is deterministic, handles identical samples and requires enough receipts', () => {
  assert.equal(clusterReceipts(sample(7).transactions), null);
  const txs = sample(12).transactions;
  const result = clusterReceipts(txs);
  assert.deepEqual(result, clusterReceipts(txs)); assert.equal(result.centers.length, 1);
  assert.deepEqual(result.labels, Array(12).fill(0));
  txs[2].outputs = []; assert.equal(clusterReceipts(txs).centers.length, 2);
});

test('research route rejects arbitrary upstreams, duplicate windows and non-GET requests', async () => {
  for (const path of ['?period=1y', '?url=https://example.com', '?period=6h&period=7d']) assert.equal((await onRequest({ request: new Request(`https://test/research${path}`) })).status, 400);
  assert.equal((await onRequest({ request: new Request('https://test/research', { method: 'POST' }) })).status, 405);
});

test('research uses the same bounded telemetry producer as Space without a circular public fetch', async t => {
  const env = { GRAFANA_PROM_URL: 'https://prometheus.example/api/prom', GRAFANA_PROM_USER: 'test', GRAFANA_PROM_TOKEN: 'test-secret' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input); calls.push(url);
    const start = Number(url.searchParams.get('start'));
    return Response.json({ status: 'success', data: { resultType: 'matrix', result: [{ values: [[start, url.searchParams.get('query').startsWith('sum(') ? '5000' : '44']] }] } });
  });
  const response = await onRequest({ request: new Request('https://test/research?period=24h'), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.delivery, 'shared_source_direct');
  assert.equal(body.independent_verification, false);
  assert.equal(body.points.length, 97);
  assert.equal(body.points[0].connections, 5000);
  assert.equal(body.points[1].connections, null);
  assert.equal(body.points[0].reporting_nodes, 44);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.origin === 'https://prometheus.example' && url.pathname.endsWith('/query_range')));
  assert.ok(!JSON.stringify(body).includes('test-secret'));
  assert.ok(parseSpaceSeries(body, '24h'));
  assert.equal((await onRequest({ request: new Request('https://test/research'), env: {} })).status, 503);
});
