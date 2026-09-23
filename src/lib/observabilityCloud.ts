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
  worstLagSlots: number | null;
  hostNodes: number | null;
  kubernetesNodes: number | null;
  podsRunning: number | null;
  podsUnhealthy: number | null;
}

function finiteMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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
    worstLagSlots: metric("bloch", "worst_lag_slots"),
    hostNodes: metric("host", "nodes"),
    kubernetesNodes: metric("kubernetes", "nodes"),
    podsRunning: metric("kubernetes", "pods_running"),
    podsUnhealthy: metric("kubernetes", "pods_unhealthy"),
  };
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
