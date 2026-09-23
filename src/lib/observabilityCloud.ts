// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ObservabilityPromotion {
  layers: number;
  state: "live" | "partial";
}

export interface ObservabilitySummary extends ObservabilityPromotion {
  sampledAt: number | null;
  targetsHealthy: number | null;
  targetsTotal: number | null;
  blochNodes: number | null;
  peerConnections: number | null;
  peerReportingNodes: number | null;
  peerSampledAt: number | null;
  peerP2pConnections: number | null;
  peerDevnetConnections: number | null;
  peerMinPerNode: number | null;
  peerMedianPerNode: number | null;
  peerMaxPerNode: number | null;
  worstLagSlots: number | null;
  blocksPerMinute: number | null;
  rejectedBlocks1h: number | null;
  hostNodes: number | null;
  hostMemoryUsedBytes: number | null;
  hostMemoryTotalBytes: number | null;
  rootDiskMinFreePercent: number | null;
  kubernetesNodes: number | null;
  podsRunning: number | null;
  podsUnhealthy: number | null;
  deploymentsAvailable: number | null;
  deploymentsDesired: number | null;
}

function finiteMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function countMetric(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

/** A small, validated read model for the homepage's infrastructure data desk. */
export function observabilitySummary(value: unknown): ObservabilitySummary | null {
  const promotion = observabilityPromotion(value);
  if (!promotion) return null;
  const data = (value as { data: Record<string, unknown> }).data;
  const metric = (group: string, key: string) => {
    const source = data[group];
    return source && typeof source === "object" && !Array.isArray(source)
      ? finiteMetric((source as Record<string, unknown>)[key]) : null;
  };
  return {
    ...promotion,
    sampledAt: finiteMetric(data.sampled_at),
    targetsHealthy: metric("prometheus", "targets_healthy"),
    targetsTotal: metric("prometheus", "targets_total"),
    blochNodes: metric("bloch", "nodes"),
    peerConnections: countMetric(metric("bloch", "peers")),
    peerReportingNodes: countMetric(metric("bloch", "peer_reporting_nodes")),
    peerSampledAt: countMetric(metric("bloch", "peer_sampled_at")),
    peerP2pConnections: countMetric(metric("bloch", "peer_p2p_connections")),
    peerDevnetConnections: countMetric(metric("bloch", "peer_devnet_connections")),
    peerMinPerNode: countMetric(metric("bloch", "peer_min_per_node")),
    peerMedianPerNode: metric("bloch", "peer_median_per_node"),
    peerMaxPerNode: countMetric(metric("bloch", "peer_max_per_node")),
    worstLagSlots: metric("bloch", "worst_lag_slots"),
    blocksPerMinute: metric("bloch", "blocks_per_minute"),
    rejectedBlocks1h: metric("bloch", "rejected_blocks_1h"),
    hostNodes: metric("host", "nodes"),
    hostMemoryUsedBytes: metric("host", "memory_used_bytes"),
    hostMemoryTotalBytes: metric("host", "memory_total_bytes"),
    rootDiskMinFreePercent: metric("host", "root_disk_min_free_percent"),
    kubernetesNodes: metric("kubernetes", "nodes"),
    podsRunning: metric("kubernetes", "pods_running"),
    podsUnhealthy: metric("kubernetes", "pods_unhealthy"),
    deploymentsAvailable: metric("kubernetes", "deployments_available"),
    deploymentsDesired: metric("kubernetes", "deployments_desired"),
  };
}

export function peerSampleFresh(sampledAt: number | null, now: number): boolean {
  return sampledAt !== null && Number.isSafeInteger(sampledAt) && Number.isSafeInteger(now) &&
    sampledAt > 0 && sampledAt <= now + 5_000 && now - sampledAt <= 90_000;
}

/** A browser-visible peer reading expires with its oldest underlying scrape. */
export function freshPeerReading(summary: ObservabilitySummary | null, now: number) {
  const sampledAt = summary?.peerSampledAt ?? null;
  if (!summary || summary.peerConnections === null || summary.peerReportingNodes === null ||
      summary.peerReportingNodes < 1 || sampledAt === null || !peerSampleFresh(sampledAt, now)) return null;
  return { connections: summary.peerConnections, reportingNodes: summary.peerReportingNodes,
    p2pConnections: summary.peerP2pConnections, devnetConnections: summary.peerDevnetConnections,
    minPerNode: summary.peerMinPerNode, medianPerNode: summary.peerMedianPerNode,
    maxPerNode: summary.peerMaxPerNode,
    sampledAt };
}

export interface PeerHistorySample { at: number; connections: number; reportingNodes: number }

/** Session observations are comparable only while reporter coverage is steady. */
export function appendPeerHistory(history: PeerHistorySample[], sample: PeerHistorySample): PeerHistorySample[] {
  if (!Number.isSafeInteger(sample.at) || sample.at <= 0 ||
      !Number.isSafeInteger(sample.connections) || sample.connections < 0 ||
      !Number.isSafeInteger(sample.reportingNodes) || sample.reportingNodes < 1) return history;
  const previous = history.at(-1);
  if (!previous) return [sample];
  if (sample.at <= previous.at) return history;
  if (sample.reportingNodes !== previous.reportingNodes || sample.at - previous.at > 75_000) return [sample];
  return [...history, sample].slice(-120);
}

/** The homepage must advertise infrastructure telemetry only after at least
 * one real metric family is present. Connectivity alone is not data. */
export function observabilityPromotion(value: unknown): ObservabilityPromotion | null {
  if (!value || typeof value !== "object") return null;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const state = (data as { state?: unknown }).state;
  if (state !== "live" && state !== "partial") return null;
  const coverage = (data as { coverage?: unknown }).coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
  const layers = Object.values(coverage).filter((item) => item === true).length;
  return layers > 0 ? { layers, state } : null;
}
