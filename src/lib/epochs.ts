// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Epochs, folded from their slots.
//
// There is no epoch-summary RPC on this chain — `getepochinfo`,
// `getepochattestations` and `getcheckpoints` are specified and none is built
// — so an epoch is thirty-two slot reads. Through `/rpc` a finalised slot is
// read from the chain once for the whole world and served from the edge cache
// for a week afterwards, which is what makes browsing history affordable: the
// first reader of an old epoch pays, everyone after them does not.
//
// The pages that use this still bound how much they ask for at once and load
// epochs in sequence, because the first reader is real and the archivals are
// two boxes serving RPC from their consensus thread.

import { G4Head } from "./g4";
import { SlotCell, slotWindow, windowStats, WindowStats } from "./slots";
import { PARAMS } from "./g4params";
import { cacheSalt } from "./g4";

export const SLOTS_PER_EPOCH = PARAMS.slotsPerEpoch.value;

export function epochOf(slot: number): number {
  return Math.floor(slot / SLOTS_PER_EPOCH);
}
export function epochSlots(epoch: number): [number, number] {
  return [epoch * SLOTS_PER_EPOCH, epoch * SLOTS_PER_EPOCH + SLOTS_PER_EPOCH - 1];
}

/** Where an epoch sits relative to the head's checkpoints. A reading, not a verdict. */
export type EpochTier = "final" | "justified" | "building" | "future";

export function tierOf(epoch: number, head: Pick<G4Head, "epoch" | "justified" | "finalized">): EpochTier {
  if (epoch > head.epoch) return "future";
  if (epoch <= head.finalized.epoch) return "final";
  if (epoch <= head.justified.epoch) return "justified";
  return "building";
}

export interface EpochSummary extends WindowStats {
  epoch: number;
  firstSlot: number;
  lastSlot: number;
  /** Slots not yet reached by the head — the in-flight epoch only. */
  pending: number;
  /** Every slot up to the head answered, and the epoch is closed. */
  complete: boolean;
  inFlight: boolean;
  /** Slot order, ascending. Only the slots at or below the head are present. */
  cells: SlotCell[];
}

export function summarizeEpoch(epoch: number, cells: SlotCell[], headSlot: number): EpochSummary {
  const [firstSlot, lastSlot] = epochSlots(epoch);
  const reachable = Math.max(0, Math.min(lastSlot, headSlot) - firstSlot + 1);
  const pending = SLOTS_PER_EPOCH - reachable;
  const stats = windowStats(cells);
  return {
    epoch,
    firstSlot,
    lastSlot,
    pending,
    inFlight: pending > 0,
    complete: pending === 0 && stats.unknown === 0 && cells.length === SLOTS_PER_EPOCH,
    cells: [...cells].sort((a, b) => a.slot - b.slot),
    ...stats,
  };
}

/**
 * Complete epochs are remembered for a while. A closed epoch's headers cannot
 * change while the lineage does not, and the edge's salt says when it did.
 */
const DONE_MS = 5 * 60_000;
const done = new Map<string, { s: EpochSummary; at: number }>();

export async function loadEpoch(
  epoch: number,
  headSlot: number,
  opts: { signal?: AbortSignal; onProgress?: (partial: EpochSummary) => void } = {},
): Promise<EpochSummary> {
  const key = `${epoch}:${cacheSalt() ?? "x"}`;
  const hit = done.get(key);
  if (hit && Date.now() - hit.at < DONE_MS) return hit.s;

  const [first, last] = epochSlots(epoch);
  const hi = Math.min(last, headSlot);
  if (hi < first) return summarizeEpoch(epoch, [], headSlot);

  const seen: SlotCell[] = [];
  const cells = await slotWindow(first, hi, {
    signal: opts.signal,
    onCell: (c) => {
      seen.push(c);
      opts.onProgress?.(summarizeEpoch(epoch, seen, headSlot));
    },
  });
  const s = summarizeEpoch(epoch, cells, headSlot);
  if (s.complete) done.set(key, { s, at: Date.now() });
  return s;
}

/** Wall-clock start of an epoch's first slot. */
export function epochStartMs(epoch: number): number {
  return PARAMS.genesisTimeMs.value + epoch * SLOTS_PER_EPOCH * PARAMS.slotSecs.value * 1000;
}

/** Histogram of block intervals into the buckets a 30-second slot makes natural. */
export function intervalBuckets(intervals: number[]): { label: string; value: number }[] {
  const edges = [30, 60, 90, 120, 180];
  const labels = ["30s", "60s", "90s", "120s", "≤180s", ">180s"];
  const counts = new Array(labels.length).fill(0);
  for (const d of intervals) {
    let i = edges.findIndex((e) => d <= e + 5);
    if (i < 0) i = labels.length - 1;
    counts[i]++;
  }
  return labels.map((label, i) => ({ label, value: counts[i] }));
}
