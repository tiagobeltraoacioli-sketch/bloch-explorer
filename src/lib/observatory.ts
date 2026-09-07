// SPDX-License-Identifier: AGPL-3.0-or-later
import type { G4Corroboration, G4Head } from "./g4";

export interface ApiReading<T> {
  data: T | null;
  error?: { code?: number; message?: string; reason?: string } | null;
  corroboration: G4Corroboration & { source_node?: string };
  cache: { state: string; age_ms: number | null };
  chain?: { slot: number | null; cache_salt: number };
}

export interface MempoolInfo {
  size?: number; max?: number; bytes?: number;
  next_base_fee_millisat_per_gas?: string;
  barred?: number | string; barred_hits?: number | string;
  expired?: number | string; evicted_low_fee?: number | string;
}

export interface RpcMethod {
  name: string; cache_class: string; cost: string; corroboration: string;
  cache_ttl_ms: number; optional: boolean; summary: string;
}

export interface Observer {
  id: string; role: "observer" | "witness";
  status: "responding" | "unavailable" | "stale" | "unobserved";
  sampled_at: number | null; age_ms: number | null; latency_ms: number | null;
  requests: number; failures: number; cooling: boolean; outcome: string | null;
  methods: Record<string, { supported: boolean | null; sampled_at: number }>;
  chain: { slot: number | null; height: number | null; lag_slots: number | null; sampled_at: number } | null;
  build: Record<string, string> | null; build_sampled_at: number | null;
}

export interface NetworkData {
  sampled_at: number; scope: string;
  head: ApiReading<G4Head>; build: ApiReading<Record<string, string>> | null;
  nodes: Observer[];
  pool: { observers: number; witnesses: number; max_per_pool: number };
  capabilities: {
    version: string; methods: RpcMethod[]; rest_resources: string[];
    absent: { name: string; why: string }[];
    limits: { upstream_calls_per_second: number; client_sustained_per_second: number; client_burst: number; fleet_witness_interval_ms: number };
  };
  counters: Record<string, number>;
  plane: { certified: boolean; responding?: number; of?: number; agree_on_head?: boolean; behind_by_slots?: number; reason?: string | null; age_ms: number | null };
  witness: { available: boolean; age_ms: number | null; height: number | null; reason?: string | null };
}

export function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Monetary values and lifetime u64 counters must never go through Number. */
export function decimal(value: unknown): string | null {
  if (typeof value === "string" && /^\d{1,78}$/.test(value)) return BigInt(value).toString();
  const n = count(value);
  return n === null ? null : String(n);
}

export function mempoolMetrics(pool: MempoolInfo | null | undefined) {
  const size = count(pool?.size), max = count(pool?.max), bytes = count(pool?.bytes);
  return {
    size, max, bytes,
    occupancy: size !== null && max !== null && max > 0 ? size / max * 100 : null,
    averageBytes: size !== null && size > 0 && bytes !== null ? bytes / size : null,
    nextFee: decimal(pool?.next_base_fee_millisat_per_gas),
  };
}

export interface PoolSample { at: number; size: number; bytes: number | null; source: string; salt: number | null }
/** Bounded, session-only history. A changed observer, reorg or sampling gap
 * starts a new series; joining them could masquerade as network activity. */
export function appendSample(history: PoolSample[], sample: PoolSample): PoolSample[] {
  const prev = history[history.length - 1];
  if (!prev || prev.source !== sample.source || prev.salt !== sample.salt || sample.at - prev.at > 60_000 || sample.at < prev.at) return [sample];
  if (sample.at === prev.at) return history;
  return [...history, sample].slice(-120);
}

export type TxStatus = "pending" | "included" | "justified" | "finalized" | "unknown";
export function transactionStatus(value: unknown): TxStatus | null {
  const status = typeof value === "string" ? value : value && typeof value === "object" ? (value as { status?: unknown }).status : null;
  return typeof status === "string" && ["pending", "included", "justified", "finalized", "unknown"].includes(status) ? status as TxStatus : null;
}
