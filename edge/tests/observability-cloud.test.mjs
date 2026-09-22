// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleObservability, observabilityQueries } from '../observability.js';
import { observabilityPromotion } from '../../src/lib/observabilityCloud.ts';

const env = {
  GRAFANA_PROM_URL: 'https://prometheus.example/api/prom',
  GRAFANA_PROM_USER: 'tenant-1',
  GRAFANA_PROM_TOKEN: 'secret-token',
};

test('observability is explicit when the server-side secret is absent', async () => {
  let called = false;
  const out = await handleObservability({ ...env, GRAFANA_PROM_TOKEN: '' }, {
    now: () => 123,
    fetchImpl: async () => { called = true; },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.state, 'unconfigured');
  assert.equal(out.body.data, null);
  assert.equal(called, false);
  assert.ok(!JSON.stringify(out).includes('tenant-1'));
});

test('observability exposes aggregate values without credentials, labels or promql', async () => {
  const seen = [];
  const values = new Map([
    [observabilityQueries.targets_total, '12'],
    [observabilityQueries.targets_healthy, '11'],
    [observabilityQueries.bloch_head_slot, '70001'],
    [observabilityQueries.host_nodes, '8'],
    [observabilityQueries.host_root_disk_min_free_percent, '12.5'],
  ]);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    seen.push({ url, authorization: init.headers.authorization });
    const value = values.get(url.searchParams.get('query'));
    return Response.json({
      status: 'success',
      data: { resultType: 'vector', result: value === undefined ? [] : [{ metric: { private_pod: 'must-not-leak' }, value: [1, value] }] },
    });
  };
  const out = await handleObservability(env, { now: () => 456, fetchImpl });
  assert.equal(out.status, 200);
  assert.equal(out.body.state, 'live');
  assert.equal(out.body.data.prometheus.targets_total, 12);
  assert.equal(out.body.data.bloch.head_slot, 70001);
  assert.equal(out.body.data.host.nodes, 8);
  assert.equal(out.body.data.host.root_disk_min_free_percent, 12.5);
  assert.deepEqual(out.body.data.coverage, { prometheus: true, bloch: true, host: true });
  assert.equal(seen.length, Object.keys(observabilityQueries).length);
  assert.ok(seen.every(({ url }) => url.origin === 'https://prometheus.example' && url.pathname === '/api/prom/api/v1/query'));
  assert.ok(seen.every(({ authorization }) => authorization === 'Basic dGVuYW50LTE6c2VjcmV0LXRva2Vu'));
  const publicBody = JSON.stringify(out.body);
  for (const secret of ['secret-token', 'tenant-1', 'private_pod', 'must-not-leak', 'count(up)']) assert.ok(!publicBody.includes(secret));
});

test('an empty but successful tenant is awaiting telemetry, not down', async () => {
  const out = await handleObservability(env, {
    now: () => 789,
    fetchImpl: async () => Response.json({ status: 'success', data: { resultType: 'vector', result: [] } }),
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.state, 'awaiting_telemetry');
  assert.deepEqual(out.body.data.coverage, { prometheus: false, bloch: false, host: false });
  assert.equal(out.body.queries.failed, 0);
});

test('partial and total Prometheus failure are distinguished', async () => {
  let calls = 0;
  const partial = await handleObservability(env, {
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return Response.json({ status: 'success', data: { resultType: 'vector', result: [{ value: [1, '1'] }] } });
      return new Response('unavailable', { status: 503 });
    },
  });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.state, 'partial');
  assert.equal(partial.body.partial, true);

  const failed = await handleObservability(env, { fetchImpl: async () => new Response('unavailable', { status: 503 }) });
  assert.equal(failed.status, 503);
  assert.equal(failed.body.state, 'unavailable');
  assert.equal(failed.body.data.provider, 'Grafana Cloud Prometheus');
});

test('only an https Prometheus endpoint is accepted', async () => {
  for (const url of ['http://prometheus.example', 'not-a-url', '']) {
    const out = await handleObservability({ ...env, GRAFANA_PROM_URL: url });
    assert.equal(out.body.state, 'unconfigured');
  }
});

test('homepage promotion requires real telemetry, not configuration or connectivity', () => {
  for (const value of [
    null,
    { data: null, state: 'unconfigured' },
    { data: { state: 'awaiting_telemetry', coverage: { prometheus: false, bloch: false, host: false } } },
    { data: { state: 'live', coverage: { prometheus: false, bloch: false, host: false } } },
  ]) assert.equal(observabilityPromotion(value), null);
  assert.deepEqual(observabilityPromotion({ data: { state: 'live', coverage: { prometheus: true, bloch: false, host: true } } }), { layers: 2, state: 'live' });
  assert.deepEqual(observabilityPromotion({ data: { state: 'partial', coverage: { prometheus: true } } }), { layers: 1, state: 'partial' });
});
