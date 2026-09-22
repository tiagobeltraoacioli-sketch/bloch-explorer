// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ObservabilityPromotion {
  layers: number;
  state: "live" | "partial";
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
