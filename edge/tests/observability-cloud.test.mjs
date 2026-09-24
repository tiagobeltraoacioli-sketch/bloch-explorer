// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleObservability, handlePeerHistory, observabilityQueries } from '../observability.js';
import { appendPeerHistory, freshPeerReading, peerRangeHistory, peerSampleFresh, observabilityPromotion, observabilitySummary } from '../../src/lib/observabilityCloud.ts';

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
  assert.match(observabilityQueries.bloch_peers, /bloch_pos_heartbeat_unix/);
  assert.doesNotMatch(observabilityQueries.bloch_peers, /timestamp\(/);
  const seen = [];
  const values = new Map([
    [observabilityQueries.targets_total, '12'],
    [observabilityQueries.targets_healthy, '11'],
    [observabilityQueries.bloch_head_slot, '70001'],
    [observabilityQueries.bloch_peers, '4623'],
    [observabilityQueries.bloch_peer_reporting_nodes, '44'],
    [observabilityQueries.bloch_peer_oldest_heartbeat_unix, '1719999999'],
    [observabilityQueries.bloch_peer_min_per_node, '104'],
    [observabilityQueries.bloch_peer_median_per_node, '105.5'],
    [observabilityQueries.bloch_peer_max_per_node, '108'],
    [observabilityQueries.bloch_peer_p2p_connections, '4600'],
    [observabilityQueries.bloch_peer_devnet_connections, '23'],
    [observabilityQueries.bloch_peer_transport_reporting_nodes, '44'],
    [observabilityQueries.bloch_mempool_sampled_nodes, '9'],
    [observabilityQueries.bloch_mempool_min_transactions, '0'],
    [observabilityQueries.bloch_mempool_max_transactions, '5'],
    [observabilityQueries.host_nodes, '8'],
    [observabilityQueries.host_root_disk_min_free_percent, '12.5'],
    [observabilityQueries.k8s_nodes, '3'],
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
  const out = await handleObservability(env, { now: () => 1720000000000, fetchImpl });
  assert.equal(out.status, 200);
  assert.equal(out.body.state, 'live');
  assert.equal(out.body.data.prometheus.targets_total, 12);
  assert.equal(out.body.data.bloch.head_slot, 70001);
  assert.equal(out.body.data.bloch.peers, 4623);
  assert.equal(out.body.data.bloch.peer_reporting_nodes, 44);
  assert.equal(out.body.data.bloch.peer_sampled_at, 1719999999000);
  assert.equal(out.body.data.bloch.peer_min_per_node, 104);
  assert.equal(out.body.data.bloch.peer_median_per_node, 105.5);
  assert.equal(out.body.data.bloch.peer_max_per_node, 108);
  assert.equal(out.body.data.bloch.peer_p2p_connections, 4600);
  assert.equal(out.body.data.bloch.peer_devnet_connections, 23);
  assert.equal(out.body.data.bloch.mempool_sampled_nodes, 9);
  assert.equal(out.body.data.bloch.mempool_min_transactions, 0);
  assert.equal(out.body.data.bloch.mempool_max_transactions, 5);
  assert.equal(out.body.data.host.nodes, 8);
  assert.equal(out.body.data.host.root_disk_min_free_percent, 12.5);
  assert.equal(out.body.data.kubernetes.nodes, 3);
  assert.deepEqual(out.body.data.coverage, { prometheus: true, bloch: true, host: true, kubernetes: true });
  assert.equal(seen.length, Object.keys(observabilityQueries).length);
  assert.ok(seen.every(({ url }) => url.origin === 'https://prometheus.example' && url.pathname === '/api/prom/api/v1/query'));
  assert.ok(seen.every(({ authorization }) => authorization === 'Basic dGVuYW50LTE6c2VjcmV0LXRva2Vu'));
  const publicBody = JSON.stringify(out.body);
  for (const secret of ['secret-token', 'tenant-1', 'private_pod', 'must-not-leak', 'count(up)']) assert.ok(!publicBody.includes(secret));
});

test('old peer samples cannot be represented as a current network reading', async () => {
  const values = new Map([
    [observabilityQueries.bloch_peers, '4623'],
    [observabilityQueries.bloch_peer_reporting_nodes, '44'],
    [observabilityQueries.bloch_peer_oldest_heartbeat_unix, '1719999800'],
  ]);
  const out = await handleObservability(env, {
    now: () => 1720000000000,
    fetchImpl: async input => {
      const value = values.get(new URL(input).searchParams.get('query'));
      return Response.json({ status: 'success', data: { resultType: 'vector',
        result: value === undefined ? [] : [{ value: [1720000000, value] }] } });
    },
  });
  assert.equal(out.body.data.bloch.peers, null);
  assert.equal(out.body.data.bloch.peer_reporting_nodes, null);
  assert.equal(out.body.data.bloch.peer_sampled_at, null);
  assert.equal(out.body.data.bloch.peer_min_per_node, null);
  assert.equal(out.body.data.bloch.peer_median_per_node, null);
  assert.equal(out.body.data.bloch.peer_max_per_node, null);
  assert.equal(out.body.data.bloch.peer_p2p_connections, null);
  assert.equal(out.body.data.bloch.peer_devnet_connections, null);
});

test('transport breakdown requires full reporter coverage and an exact total', async () => {
  for (const [reporters, p2p] of [['43', '4600'], ['44', '4599']]) {
    const values = new Map([
      [observabilityQueries.bloch_peers, '4623'],
      [observabilityQueries.bloch_peer_reporting_nodes, '44'],
      [observabilityQueries.bloch_peer_oldest_heartbeat_unix, '1719999999'],
      [observabilityQueries.bloch_peer_p2p_connections, p2p],
      [observabilityQueries.bloch_peer_devnet_connections, '23'],
      [observabilityQueries.bloch_peer_transport_reporting_nodes, reporters],
    ]);
    const out = await handleObservability(env, {
      now: () => 1720000000000,
      fetchImpl: async input => {
        const value = values.get(new URL(input).searchParams.get('query'));
        return Response.json({ status: 'success', data: { resultType: 'vector',
          result: value === undefined ? [] : [{ value: [1720000000, value] }] } });
      },
    });
    assert.equal(out.body.data.bloch.peers, 4623);
    assert.equal(out.body.data.bloch.peer_p2p_connections, null);
    assert.equal(out.body.data.bloch.peer_devnet_connections, null);
  }
});

test('impossible peer distribution is withheld while the fresh total remains available', async () => {
  const values = new Map([
    [observabilityQueries.bloch_peers, '10'],
    [observabilityQueries.bloch_peer_reporting_nodes, '2'],
    [observabilityQueries.bloch_peer_oldest_heartbeat_unix, '1719999999'],
    [observabilityQueries.bloch_peer_min_per_node, '8'],
    [observabilityQueries.bloch_peer_median_per_node, '7'],
    [observabilityQueries.bloch_peer_max_per_node, '9'],
  ]);
  const out = await handleObservability(env, {
    now: () => 1720000000000,
    fetchImpl: async input => {
      const value = values.get(new URL(input).searchParams.get('query'));
      return Response.json({ status: 'success', data: { resultType: 'vector',
        result: value === undefined ? [] : [{ value: [1720000000, value] }] } });
    },
  });
  assert.equal(out.body.data.bloch.peers, 10);
  assert.equal(out.body.data.bloch.peer_min_per_node, null);
  assert.equal(out.body.data.bloch.peer_median_per_node, null);
  assert.equal(out.body.data.bloch.peer_max_per_node, null);
});

test('an empty but successful tenant is awaiting telemetry, not down', async () => {
  const out = await handleObservability(env, {
    now: () => 789,
    fetchImpl: async () => Response.json({ status: 'success', data: { resultType: 'vector', result: [] } }),
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.state, 'awaiting_telemetry');
  assert.deepEqual(out.body.data.coverage, { prometheus: false, bloch: false, host: false, kubernetes: false });
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
    { data: { state: 'awaiting_telemetry', coverage: { prometheus: false, bloch: false, host: false, kubernetes: false } } },
    { data: { state: 'live', coverage: { prometheus: false, bloch: false, host: false, kubernetes: false } } },
  ]) assert.equal(observabilityPromotion(value), null);
  assert.deepEqual(observabilityPromotion({ data: { state: 'live', coverage: { prometheus: true, bloch: false, host: true, kubernetes: false } } }), { layers: 2, state: 'live' });
  assert.deepEqual(observabilityPromotion({ data: { state: 'partial', coverage: { prometheus: true } } }), { layers: 1, state: 'partial' });
});

test('homepage summary preserves measured zeros and rejects invalid metrics', () => {
  const summary = observabilitySummary({ data: {
    state: 'live', sampled_at: 1720000000000,
    coverage: { prometheus: true, bloch: true, host: true, kubernetes: true },
    prometheus: { targets_healthy: 56, targets_total: 56 },
    bloch: { nodes: 44, peers: 0, peer_reporting_nodes: 44, peer_sampled_at: 1720000000000,
      peer_p2p_connections: 0, peer_devnet_connections: 0,
      peer_min_per_node: 0, peer_median_per_node: 0, peer_max_per_node: 0,
      worst_lag_slots: 0, blocks_per_minute: 2, rejected_blocks_1h: 0 },
    host: { nodes: 7, memory_used_bytes: 50, memory_total_bytes: 100, root_disk_min_free_percent: 90 },
    kubernetes: { nodes: 1, pods_running: 6, pods_unhealthy: 0, deployments_available: 5, deployments_desired: 5 },
  } });
  assert.deepEqual(summary, {
    layers: 4, state: 'live', sampledAt: 1720000000000,
    targetsHealthy: 56, targetsTotal: 56, blochNodes: 44, peerConnections: 0, peerReportingNodes: 44,
    peerSampledAt: 1720000000000,
    peerP2pConnections: 0, peerDevnetConnections: 0,
    peerMinPerNode: 0, peerMedianPerNode: 0, peerMaxPerNode: 0,
    worstLagSlots: 0, blocksPerMinute: 2, rejectedBlocks1h: 0,
    hostNodes: 7, hostMemoryUsedBytes: 50, hostMemoryTotalBytes: 100,
    rootDiskMinFreePercent: 90, kubernetesNodes: 1,
    podsRunning: 6, podsUnhealthy: 0, deploymentsAvailable: 5, deploymentsDesired: 5,
  });
  assert.deepEqual(freshPeerReading(summary, 1720000089999), {
    connections: 0, reportingNodes: 44, p2pConnections: 0, devnetConnections: 0,
    minPerNode: 0, medianPerNode: 0, maxPerNode: 0,
    sampledAt: 1720000000000,
  });
  assert.equal(freshPeerReading(summary, 1720000090001), null);
  assert.equal(peerSampleFresh(1720000000000, 1720000090001), false);
  assert.equal(freshPeerReading({ ...summary, peerSampledAt: null }, 1720000000000), null);
  assert.equal(observabilitySummary({ data: { state: 'awaiting_telemetry', coverage: { prometheus: false } } }), null);
});

test('peer session history rejects repeats and separates coverage changes or sampling gaps', () => {
  const first = { at: 1720000000000, connections: 5500, reportingNodes: 44 };
  assert.deepEqual(appendPeerHistory([], first), [first]);
  assert.deepEqual(appendPeerHistory([first], first), [first]);
  assert.deepEqual(appendPeerHistory([first], { ...first, at: first.at - 1 }), [first]);
  assert.deepEqual(appendPeerHistory([first], { ...first, at: first.at + 30_000, connections: 5505 }),
    [first, { ...first, at: first.at + 30_000, connections: 5505 }]);
  assert.deepEqual(appendPeerHistory([first], { ...first, at: first.at + 30_000, reportingNodes: 43 }),
    [{ ...first, at: first.at + 30_000, reportingNodes: 43 }]);
  assert.deepEqual(appendPeerHistory([first], { ...first, at: first.at + 75_001 }),
    [{ ...first, at: first.at + 75_001 }]);
  assert.deepEqual(appendPeerHistory([first], { ...first, at: first.at + 30_000, connections: -1 }), [first]);
  let history = [first];
  for (let i = 1; i <= 140; i++) history = appendPeerHistory(history,
    { ...first, at: first.at + i * 30_000, connections: 5500 + i });
  assert.equal(history.length, 120);
  assert.equal(history[0].connections, 5521);
});

test('fixed six-hour peer history preserves gaps and hides Prometheus labels', async () => {
  const now = 1720000000000;
  const end = Math.floor(now / 300_000) * 300;
  const start = end - 72 * 300;
  const seen = [];
  const out = await handlePeerHistory(env, {
    now: () => now,
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      seen.push({ url, auth: init.headers.authorization });
      const query = url.searchParams.get('query');
      const values = query === observabilityQueries.bloch_peers
        ? [[start, '0'], [start + 300, '5300'], [end, '5500']]
        : query === observabilityQueries.bloch_peer_reporting_nodes
          ? [[start, '44'], [end, '44']] : [];
      return Response.json({ status: 'success', data: { resultType: 'matrix',
        result: [{ metric: { private_host: 'must-not-leak' }, values }] } });
    },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.state, 'live');
  assert.equal(out.body.data.period, '6h');
  assert.equal(out.body.data.points.length, 73);
  assert.equal(out.body.data.valid_points, 2);
  assert.deepEqual(out.body.data.points[0], { at: start * 1000, connections: 0, reporting_nodes: 44 });
  assert.deepEqual(out.body.data.points[1], { at: (start + 300) * 1000, connections: null, reporting_nodes: null });
  assert.deepEqual(out.body.data.points[72], { at: end * 1000, connections: 5500, reporting_nodes: 44 });
  assert.equal(peerRangeHistory(out.body)?.length, 73);
  assert.equal(seen.length, 2);
  assert.ok(seen.every(({ url, auth }) => url.pathname === '/api/prom/api/v1/query_range' &&
    url.searchParams.get('start') === String(start) && url.searchParams.get('end') === String(end) &&
    url.searchParams.get('step') === '300' && auth === 'Basic dGVuYW50LTE6c2VjcmV0LXRva2Vu'));
  assert.ok(!JSON.stringify(out.body).includes('private_host'));
  assert.ok(!JSON.stringify(out.body).includes('must-not-leak'));
  assert.ok(!JSON.stringify(out.body).includes('secret-token'));
  assert.ok(!JSON.stringify(out.body).includes('bloch_pos_peer_count'));
});

test('peer history rejects invalid matrix responses and malformed browser data', async () => {
  const out = await handlePeerHistory(env, {
    now: () => 1720000000000,
    fetchImpl: async () => Response.json({ status: 'success', data: { resultType: 'vector', result: [] } }),
  });
  assert.equal(out.status, 503);
  assert.equal(out.body.error.reason, 'prometheus_history_unavailable');
  const unconfigured = await handlePeerHistory({ ...env, GRAFANA_PROM_TOKEN: '' }, {
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  assert.equal(unconfigured.body.state, 'unconfigured');
  const start = 1720000000000;
  const points = Array.from({ length: 73 }, (_, index) =>
    ({ at: start + index * 300_000, connections: 5, reporting_nodes: 2 }));
  const good = { data: { period: '6h', start_at: start, end_at: start + 72 * 300_000, step_seconds: 300, points } };
  assert.equal(peerRangeHistory(good)?.length, 73);
  assert.equal(peerRangeHistory(good, '24h'), null);
  assert.equal(peerRangeHistory({ data: { ...good.data, points: points.slice(1) } }), null);
  assert.equal(peerRangeHistory({ data: { ...good.data, points: [{ ...points[0], reporting_nodes: 0 }, ...points.slice(1)] } }), null);
});

test('history periods are allowlisted with bounded fixed resolutions', async () => {
  for (const [period, step, steps] of [['24h', 900, 96], ['7d', 3600, 168]]) {
    const seen = [];
    const out = await handlePeerHistory(env, {
      period, now: () => 1720000000000,
      fetchImpl: async input => {
        seen.push(new URL(input));
        return Response.json({ status: 'success', data: { resultType: 'matrix', result: [] } });
      },
    });
    assert.equal(out.status, 200);
    assert.equal(out.body.state, 'awaiting_telemetry');
    assert.equal(out.body.data.period, period);
    assert.equal(out.body.data.step_seconds, step);
    assert.equal(out.body.data.points.length, steps + 1);
    assert.equal(out.body.data.valid_points, 0);
    assert.equal(peerRangeHistory(out.body, period)?.length, steps + 1);
    assert.equal(seen.length, 2);
    assert.ok(seen.every(url => url.searchParams.get('step') === String(step)));
  }
  let fetched = false;
  const invalid = await handlePeerHistory(env, { period: '30d',
    fetchImpl: async () => { fetched = true; } });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body.error.allowed, ['6h', '24h', '7d']);
  assert.equal(fetched, false);
});
