// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A deliberately narrow Grafana Cloud Prometheus reader. The public endpoint
// does not accept PromQL: every query is fixed here, aggregate-only, and
// returns no infrastructure labels. This keeps the access token and the
// cluster inventory on the server side.

const QUERY_TIMEOUT_MS = 6_000;
const PEER_MAX_SAMPLE_AGE_SECONDS = 90;
const PEER_HISTORY_STEP_SECONDS = 300;
const PEER_HISTORY_STEPS = 72;
// The node updates heartbeat_unix and peer_count in the same metrics pass.
// Prometheus timestamp() on an instant expression reflects evaluation time,
// so use the node's heartbeat VALUE to reject old scraped observations.
const FRESH_PEER_SERIES =
  'bloch_pos_peer_count and on(instance) (bloch_pos_head_slot > 0) ' +
  `and on(instance) (time() - bloch_pos_heartbeat_unix <= ${PEER_MAX_SAMPLE_AGE_SECONDS}) ` +
  'and on(instance) (bloch_pos_heartbeat_unix <= time() + 5)';

const QUERIES = Object.freeze({
  targets_total: 'count(up)',
  targets_healthy: 'sum(up)',
  targets_unhealthy: 'count(up) - sum(up)',

  // Booting/replaying exporters deliberately report a zero head and heartbeat.
  // They are scrapeable targets, but not yet chain observers.
  bloch_nodes: 'count(bloch_pos_head_slot > 0)',
  bloch_head_slot: 'max(bloch_pos_head_slot)',
  bloch_finalized_epoch: 'max(bloch_pos_finalized_epoch)',
  bloch_worst_lag_slots: 'max(bloch_pos_behind_by_slots)',
  // Connections seen by active monitored nodes. A peer shared by two
  // observers may be counted twice; this is not a unique-network-peer count.
  bloch_peers: `sum(${FRESH_PEER_SERIES})`,
  bloch_peer_reporting_nodes: `count(${FRESH_PEER_SERIES})`,
  bloch_peer_oldest_heartbeat_unix: `min(bloch_pos_heartbeat_unix and on(instance) (${FRESH_PEER_SERIES}))`,
  bloch_peer_min_per_node: `min(${FRESH_PEER_SERIES})`,
  bloch_peer_median_per_node: `quantile(0.5, ${FRESH_PEER_SERIES})`,
  bloch_peer_max_per_node: `max(${FRESH_PEER_SERIES})`,
  bloch_peer_p2p_connections: `sum(bloch_pos_peer_count_p2p and on(instance) (${FRESH_PEER_SERIES}))`,
  bloch_peer_devnet_connections: `sum(bloch_pos_peer_count_devnet and on(instance) (${FRESH_PEER_SERIES}))`,
  bloch_peer_transport_reporting_nodes: `count(bloch_pos_peer_count_p2p and on(instance) (bloch_pos_peer_count_devnet) and on(instance) (${FRESH_PEER_SERIES}))`,
  bloch_mempool_transactions: 'sum(bloch_pos_mempool_size)',
  bloch_mempool_sampled_nodes: 'count(bloch_pos_mempool_size and on(instance) (bloch_pos_head_slot > 0))',
  bloch_mempool_min_transactions: 'min(bloch_pos_mempool_size and on(instance) (bloch_pos_head_slot > 0))',
  bloch_mempool_max_transactions: 'max(bloch_pos_mempool_size and on(instance) (bloch_pos_head_slot > 0))',
  // Every validator applies the same canonical blocks, so summing multiplies
  // chain throughput by the number of exporters. Select one synchronized
  // observer's rate instead.
  bloch_blocks_per_minute: 'max(rate(bloch_pos_blocks_applied_total[5m]) and on(instance) (bloch_pos_head_slot > 0) and on(instance) (bloch_pos_behind_by_slots <= 2)) * 60',
  bloch_rejected_blocks_1h: 'sum(increase(bloch_pos_blocks_rejected_total[1h]))',
  bloch_heartbeat_age_seconds: 'max(time() - (bloch_pos_heartbeat_unix > 0))',

  host_nodes: 'count(node_uname_info)',
  host_cpu_busy_cores: 'sum(rate(node_cpu_seconds_total{mode!="idle"}[5m]))',
  host_memory_used_bytes: 'sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)',
  host_memory_total_bytes: 'sum(node_memory_MemTotal_bytes)',
  host_root_disk_free_bytes: 'sum(node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"})',
  host_root_disk_min_free_percent: 'min(100 * node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"})',

  k8s_nodes: 'count(kube_node_info)',
  k8s_pods_running: 'sum(kube_pod_status_phase{phase="Running"})',
  k8s_pods_unhealthy: 'sum(kube_pod_status_phase{phase=~"Pending|Failed|Unknown"})',
  k8s_container_restarts: 'sum(kube_pod_container_status_restarts_total)',
  k8s_deployments_desired: 'sum(kube_deployment_spec_replicas)',
  k8s_deployments_available: 'sum(kube_deployment_status_replicas_available)',
  k8s_cpu_cores: 'sum(rate(container_cpu_usage_seconds_total{container!="",image!=""}[5m]))',
  k8s_memory_bytes: 'sum(container_memory_working_set_bytes{container!="",image!=""})',
});

const GROUPS = Object.freeze({
  prometheus: ['targets_total', 'targets_healthy', 'targets_unhealthy'],
  bloch: [
    'bloch_nodes', 'bloch_head_slot', 'bloch_finalized_epoch', 'bloch_worst_lag_slots',
    'bloch_peers', 'bloch_peer_reporting_nodes', 'bloch_peer_min_per_node',
    'bloch_peer_median_per_node', 'bloch_peer_max_per_node', 'bloch_peer_p2p_connections',
    'bloch_peer_devnet_connections', 'bloch_mempool_transactions', 'bloch_mempool_sampled_nodes',
    'bloch_mempool_min_transactions', 'bloch_mempool_max_transactions', 'bloch_blocks_per_minute',
    'bloch_rejected_blocks_1h', 'bloch_heartbeat_age_seconds',
  ],
  host: [
    'host_nodes', 'host_cpu_busy_cores', 'host_memory_used_bytes',
    'host_memory_total_bytes', 'host_root_disk_free_bytes',
    'host_root_disk_min_free_percent',
  ],
  kubernetes: [
    'k8s_nodes', 'k8s_pods_running', 'k8s_pods_unhealthy', 'k8s_container_restarts',
    'k8s_deployments_desired', 'k8s_deployments_available', 'k8s_cpu_cores',
    'k8s_memory_bytes',
  ],
});

function endpoint(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    url.pathname = url.pathname.replace(/\/$/, '') + '/api/v1/query';
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function basicAuth(user, password) {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function finiteSample(body) {
  if (body?.status !== 'success' || body?.data?.resultType !== 'vector') return null;
  const raw = body.data.result?.[0]?.value?.[1];
  const value = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : null;
}

async function queryPrometheus(base, auth, query, fetchImpl) {
  const url = new URL(base);
  url.searchParams.set('query', query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: auth },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`prometheus_http_${response.status}`);
    return finiteSample(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function rangeSamples(body, start, end) {
  if (body?.status !== 'success' || body?.data?.resultType !== 'matrix') throw new Error('prometheus_invalid_matrix');
  const result = body.data.result;
  if (!Array.isArray(result) || result.length > 1) throw new Error('prometheus_invalid_matrix');
  const samples = new Map();
  for (const pair of result[0]?.values ?? []) {
    const seconds = pair?.[0];
    const value = typeof pair?.[1] === 'string' ? Number(pair[1]) : NaN;
    if (!Number.isSafeInteger(seconds) || seconds < start || seconds > end ||
        (seconds - start) % PEER_HISTORY_STEP_SECONDS !== 0 ||
        !Number.isSafeInteger(value) || value < 0) continue;
    samples.set(seconds, value);
  }
  return samples;
}

async function queryPeerRange(base, auth, query, start, end, fetchImpl) {
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/query$/, '/query_range');
  url.searchParams.set('query', query);
  url.searchParams.set('start', String(start));
  url.searchParams.set('end', String(end));
  url.searchParams.set('step', String(PEER_HISTORY_STEP_SECONDS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET', headers: { accept: 'application/json', authorization: auth }, signal: controller.signal,
    });
    if (!response.ok) throw new Error(`prometheus_http_${response.status}`);
    return rangeSamples(await response.json(), start, end);
  } finally {
    clearTimeout(timer);
  }
}

/** A fixed, bounded public history with no PromQL or infrastructure labels. */
export async function handlePeerHistory(env, runtime = {}) {
  const sampledAt = (runtime.now ?? Date.now)();
  const base = endpoint(env?.GRAFANA_PROM_URL);
  const user = typeof env?.GRAFANA_PROM_USER === 'string' ? env.GRAFANA_PROM_USER.trim() : '';
  const token = typeof env?.GRAFANA_PROM_TOKEN === 'string' ? env.GRAFANA_PROM_TOKEN : '';
  if (!base || !user || !token) return { status: 200, body: { data: null, state: 'unconfigured', sampled_at: sampledAt } };
  const end = Math.floor(sampledAt / (PEER_HISTORY_STEP_SECONDS * 1000)) * PEER_HISTORY_STEP_SECONDS;
  const start = end - PEER_HISTORY_STEPS * PEER_HISTORY_STEP_SECONDS;
  const auth = basicAuth(user, token);
  try {
    const [connections, reporters] = await Promise.all([
      queryPeerRange(base, auth, QUERIES.bloch_peers, start, end, runtime.fetchImpl ?? fetch),
      queryPeerRange(base, auth, QUERIES.bloch_peer_reporting_nodes, start, end, runtime.fetchImpl ?? fetch),
    ]);
    const points = Array.from({ length: PEER_HISTORY_STEPS + 1 }, (_, index) => {
      const seconds = start + index * PEER_HISTORY_STEP_SECONDS;
      const count = connections.get(seconds), nodes = reporters.get(seconds);
      return { at: seconds * 1000,
        connections: count !== undefined && nodes !== undefined && nodes > 0 ? count : null,
        reporting_nodes: count !== undefined && nodes !== undefined && nodes > 0 ? nodes : null };
    });
    const validPoints = points.filter(point => point.connections !== null).length;
    return { status: 200, body: { data: { points, step_seconds: PEER_HISTORY_STEP_SECONDS,
      start_at: start * 1000, end_at: end * 1000, valid_points: validPoints },
      state: validPoints ? 'live' : 'awaiting_telemetry', sampled_at: sampledAt } };
  } catch {
    return { status: 503, body: { data: null, state: 'unavailable', sampled_at: sampledAt,
      error: { reason: 'prometheus_history_unavailable' } } };
  }
}

function hasAny(values, keys) {
  return keys.some((key) => values[key] !== null);
}

/**
 * Returns the same { status, body } envelope as edge/api.js so the Pages
 * adapter can apply one response policy to chain and infrastructure reads.
 */
export async function handleObservability(env, runtime = {}) {
  const sampledAt = (runtime.now ?? Date.now)();
  const base = endpoint(env?.GRAFANA_PROM_URL);
  const user = typeof env?.GRAFANA_PROM_USER === 'string' ? env.GRAFANA_PROM_USER.trim() : '';
  const token = typeof env?.GRAFANA_PROM_TOKEN === 'string' ? env.GRAFANA_PROM_TOKEN : '';
  if (!base || !user || !token) {
    return {
      status: 200,
      body: {
        data: null,
        state: 'unconfigured',
        sampled_at: sampledAt,
        error: { reason: 'grafana_cloud_not_configured' },
      },
    };
  }

  const auth = basicAuth(user, token);
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const entries = Object.entries(QUERIES);
  const settled = await Promise.allSettled(
    entries.map(([, promql]) => queryPrometheus(base, auth, promql, fetchImpl)),
  );
  const values = Object.fromEntries(entries.map(([name], index) => [
    name,
    settled[index].status === 'fulfilled' ? settled[index].value : null,
  ]));
  const peerSampleSeconds = values.bloch_peer_oldest_heartbeat_unix;
  const peerSampleMs = peerSampleSeconds === null ? null : Math.round(peerSampleSeconds * 1000);
  const peersFresh = Number.isSafeInteger(peerSampleMs) && peerSampleMs > 0 &&
    peerSampleMs <= sampledAt + 5_000 && sampledAt - peerSampleMs <= PEER_MAX_SAMPLE_AGE_SECONDS * 1000 &&
    Number.isSafeInteger(values.bloch_peers) && values.bloch_peers >= 0 &&
    Number.isSafeInteger(values.bloch_peer_reporting_nodes) && values.bloch_peer_reporting_nodes > 0;
  if (!peersFresh) {
    values.bloch_peers = null;
    values.bloch_peer_reporting_nodes = null;
  }
  // Older node builds may export the total without the transport gauges.
  // Show a breakdown only when both gauges cover every node in the total.
  const peerTransportComplete = peersFresh &&
    Number.isSafeInteger(values.bloch_peer_p2p_connections) && values.bloch_peer_p2p_connections >= 0 &&
    Number.isSafeInteger(values.bloch_peer_devnet_connections) && values.bloch_peer_devnet_connections >= 0 &&
    values.bloch_peer_transport_reporting_nodes === values.bloch_peer_reporting_nodes &&
    values.bloch_peer_p2p_connections + values.bloch_peer_devnet_connections === values.bloch_peers;
  const peerRangeComplete = peersFresh &&
    Number.isSafeInteger(values.bloch_peer_min_per_node) && values.bloch_peer_min_per_node >= 0 &&
    Number.isFinite(values.bloch_peer_median_per_node) && values.bloch_peer_median_per_node >= 0 &&
    Number.isSafeInteger(values.bloch_peer_max_per_node) && values.bloch_peer_max_per_node >= 0 &&
    values.bloch_peer_min_per_node <= values.bloch_peer_median_per_node &&
    values.bloch_peer_median_per_node <= values.bloch_peer_max_per_node &&
    values.bloch_peer_max_per_node <= values.bloch_peers;
  const failures = settled.filter((result) => result.status === 'rejected').length;
  const successes = settled.length - failures;
  const anyTelemetry = Object.values(values).some((value) => value !== null);
  const state = successes === 0 ? 'unavailable' : failures > 0 ? 'partial' : anyTelemetry ? 'live' : 'awaiting_telemetry';

  return {
    status: successes === 0 ? 503 : 200,
    body: {
      data: {
        provider: 'Grafana Cloud Prometheus',
        state,
        sampled_at: sampledAt,
        coverage: {
          prometheus: hasAny(values, GROUPS.prometheus),
          bloch: hasAny(values, GROUPS.bloch),
          host: hasAny(values, GROUPS.host),
          kubernetes: hasAny(values, GROUPS.kubernetes),
        },
        prometheus: {
          targets_total: values.targets_total,
          targets_healthy: values.targets_healthy,
          targets_unhealthy: values.targets_unhealthy,
        },
        bloch: {
          nodes: values.bloch_nodes,
          head_slot: values.bloch_head_slot,
          finalized_epoch: values.bloch_finalized_epoch,
          worst_lag_slots: values.bloch_worst_lag_slots,
          peers: values.bloch_peers,
          peer_reporting_nodes: values.bloch_peer_reporting_nodes,
          peer_sampled_at: peersFresh ? peerSampleMs : null,
          peer_min_per_node: peerRangeComplete ? values.bloch_peer_min_per_node : null,
          peer_median_per_node: peerRangeComplete ? values.bloch_peer_median_per_node : null,
          peer_max_per_node: peerRangeComplete ? values.bloch_peer_max_per_node : null,
          peer_p2p_connections: peerTransportComplete ? values.bloch_peer_p2p_connections : null,
          peer_devnet_connections: peerTransportComplete ? values.bloch_peer_devnet_connections : null,
          mempool_transactions: values.bloch_mempool_transactions,
          mempool_sampled_nodes: values.bloch_mempool_sampled_nodes,
          mempool_min_transactions: values.bloch_mempool_min_transactions,
          mempool_max_transactions: values.bloch_mempool_max_transactions,
          blocks_per_minute: values.bloch_blocks_per_minute,
          rejected_blocks_1h: values.bloch_rejected_blocks_1h,
          heartbeat_age_seconds: values.bloch_heartbeat_age_seconds,
        },
        host: {
          nodes: values.host_nodes,
          cpu_busy_cores: values.host_cpu_busy_cores,
          memory_used_bytes: values.host_memory_used_bytes,
          memory_total_bytes: values.host_memory_total_bytes,
          root_disk_free_bytes: values.host_root_disk_free_bytes,
          root_disk_min_free_percent: values.host_root_disk_min_free_percent,
        },
        kubernetes: {
          nodes: values.k8s_nodes,
          pods_running: values.k8s_pods_running,
          pods_unhealthy: values.k8s_pods_unhealthy,
          container_restarts: values.k8s_container_restarts,
          deployments_desired: values.k8s_deployments_desired,
          deployments_available: values.k8s_deployments_available,
          cpu_cores: values.k8s_cpu_cores,
          memory_bytes: values.k8s_memory_bytes,
        },
      },
      state,
      sampled_at: sampledAt,
      partial: failures > 0,
      queries: { succeeded: successes, failed: failures, total: settled.length },
      error: failures > 0 ? { reason: successes ? 'prometheus_partial_read' : 'prometheus_unavailable' } : null,
    },
  };
}

export const observabilityQueries = QUERIES;
