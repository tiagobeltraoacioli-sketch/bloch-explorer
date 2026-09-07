// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slot windows through the explorer's own edge.
//
// `lib/source.ts` reads slots through `/g4`, which asks BOTH archivals on every
// request and stores nothing: that is the right transport for a page whose
// whole point is the two-node comparison (the block page, the range browser).
// It is the wrong transport for a strip or a chart that wants thirty-two
// slots on every poll from every open tab, because each of those slots costs
// the chain two calls and the finalised ones can never change.
//
// This module reads the same slots through `/rpc` — `edge/core.js` — which
// caches a finalised slot for a week, coalesces every tab in the world onto one
// upstream call, and caps the calls it will make no matter how many arrive. The
// price is that a single read is not itself a cross-check; the edge's own
// corroboration level travels with each answer instead, and the pages that
// need the explicit comparison keep using `source.ts`.
//
// The three-state rule from `source.ts` holds here unchanged: a slot holds a
// block, or the chain said it holds nothing, or we could not find out. The
// third must never be drawn as the second — that is a missed proposal invented
// against a named validator. The node says which is which in the error CODE,
// `-32007 SLOT_EMPTY`, and `G4Error` now carries that code across.

import { g4rpc, G4Block, G4Error, cacheSalt } from "./g4";
import { CODE, SlotCell } from "./source";
import { PARAMS } from "./g4params";

export type { SlotCell } from "./source";

/** Concurrent reads in flight for one window. Small on purpose. */
export const WINDOW_CONCURRENCY = 4;

/**
 * Cell cache. Time-bounded for the same reason `source.ts` bounds its own: a
 * block's header cannot change while its id does not, but the FINALITY word
 * inside it is the answering node's reading and moves, and an epoch boundary is
 * exactly when it moves. Sixty seconds is far shorter than an epoch.
 *
 * Keyed alongside the edge's cache salt: when the edge detects a reorg it bumps
 * the salt, and a browser holding cells from the old lineage must drop them.
 */
const CACHE_MS = 60_000;
interface Entry { cell: SlotCell; at: number }
const cache = new Map<number, Entry>();
let cacheSaltSeen: number | null = null;

function honourSalt() {
  const s = cacheSalt();
  if (s !== null && cacheSaltSeen !== null && s !== cacheSaltSeen) cache.clear();
  if (s !== null) cacheSaltSeen = s;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

/**
 * One slot. A throttle from the edge (429, `retry_after_ms`) is waited out
 * once or twice rather than rendered as a gap: the budget refills within a
 * second or two, and a strip full of "unread" cells because a tab opened
 * quickly would say something false about the chain.
 */
export async function edgeSlot(slot: number, signal?: AbortSignal): Promise<SlotCell> {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) return { kind: "unknown", slot, why: "cancelled" };
    try {
      const block = await g4rpc<G4Block>("getblockbyslot", [slot], { signal });
      return { kind: "block", slot, block };
    } catch (e) {
      if (e instanceof G4Error) {
        if (e.code === CODE.SLOT_EMPTY) return { kind: "empty", slot };
        if (e.retryAfterMs !== null && attempt < 2) {
          await sleep(Math.min(e.retryAfterMs, 6_000) + 50, signal);
          continue;
        }
        return { kind: "unknown", slot, why: e.message };
      }
      return { kind: "unknown", slot, why: e instanceof Error ? e.message : String(e) };
    }
  }
}

async function cachedSlot(slot: number, signal?: AbortSignal, fresh = false): Promise<SlotCell> {
  honourSalt();
  const hit = cache.get(slot);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.cell;
  const cell = await edgeSlot(slot, signal);
  // Failures are never cached — retrying is the point of a failure.
  if (cell.kind !== "unknown") cache.set(slot, { cell, at: Date.now() });
  return cell;
}

/** Drop what this browser holds, for a reader who asks for a fresh read. */
export function clearWindowCache(): void {
  cache.clear();
}

async function mapLimit<T, R>(items: T[], limit: number, work: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runner = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return out;
}

/**
 * Every slot in `[lo, hi]`, ASCENDING, each labelled as what it is.
 *
 * `onCell` fires as each cell resolves so a page can paint progressively; the
 * resolved array is the same cells in slot order. `fresh` names the slots that
 * must bypass the browser cache — the newest few on a live strip, whose
 * finality word is the one thing on this chain that moves between polls.
 */
export async function slotWindow(
  lo: number,
  hi: number,
  opts: {
    signal?: AbortSignal;
    onCell?: (c: SlotCell) => void;
    concurrency?: number;
    fresh?: (slot: number) => boolean;
  } = {},
): Promise<SlotCell[]> {
  const a = Math.max(0, Math.min(lo, hi));
  const b = Math.max(lo, hi);
  // Newest first on the wire — the head is what a reader is waiting for — but
  // returned oldest first, which is how every strip and chart lays them out.
  const slots: number[] = [];
  for (let s = b; s >= a; s--) slots.push(s);
  const cells = await mapLimit(slots, opts.concurrency ?? WINDOW_CONCURRENCY, async (s) => {
    const c = await cachedSlot(s, opts.signal, opts.fresh?.(s) ?? false);
    opts.onCell?.(c);
    return c;
  });
  return cells.reverse();
}

// ---------------------------------------------------------------------------
// Arithmetic over a window. Nothing here invents a figure the cells do not
// carry; where a number cannot be derived it is null, never zero.
// ---------------------------------------------------------------------------

export interface WindowStats {
  slots: number;
  blocks: number;
  /** The chain said: no block here. A missed proposal. */
  empty: number;
  /** We could not read it. NOT a missed proposal. */
  unknown: number;
  /** blocks / (blocks + empty). Null when nothing was readable. */
  fillRate: number | null;
  txs: number;
  votes: number;
  meanAttestations: number | null;
  /** Blocks proposed, by validator index. */
  proposers: Map<number, number>;
  distinctProposers: number;
  /** Seconds between consecutive blocks, in slot order. */
  intervals: number[];
  meanIntervalSecs: number | null;
  firstTs: number | null;
  lastTs: number | null;
}

export function windowStats(cells: SlotCell[]): WindowStats {
  let blocks = 0, empty = 0, unknown = 0, txs = 0, votes = 0;
  const proposers = new Map<number, number>();
  const intervals: number[] = [];
  let prevTs: number | null = null;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  const ordered = [...cells].sort((x, y) => x.slot - y.slot);
  for (const c of ordered) {
    if (c.kind === "empty") { empty++; continue; }
    if (c.kind === "unknown") { unknown++; continue; }
    blocks++;
    txs += c.block.tx_count;
    votes += c.block.attestation_count;
    proposers.set(c.block.proposer_index, (proposers.get(c.block.proposer_index) ?? 0) + 1);
    if (prevTs !== null) intervals.push(c.block.timestamp - prevTs);
    prevTs = c.block.timestamp;
    if (firstTs === null) firstTs = c.block.timestamp;
    lastTs = c.block.timestamp;
  }
  const readable = blocks + empty;
  return {
    slots: cells.length,
    blocks,
    empty,
    unknown,
    fillRate: readable === 0 ? null : blocks / readable,
    txs,
    votes,
    meanAttestations: blocks === 0 ? null : votes / blocks,
    proposers,
    distinctProposers: proposers.size,
    intervals,
    meanIntervalSecs: intervals.length === 0 ? null : intervals.reduce((a, b) => a + b, 0) / intervals.length,
    firstTs,
    lastTs,
  };
}

/** Wall-clock start of a slot, from the genesis time and the slot length. */
export function slotStartMs(slot: number): number {
  return PARAMS.genesisTimeMs.value + slot * PARAMS.slotSecs.value * 1000;
}

/** The slot the wall clock says it is right now. */
export function wallSlot(nowMs = Date.now()): number {
  return Math.floor((nowMs - PARAMS.genesisTimeMs.value) / (PARAMS.slotSecs.value * 1000));
}

/**
 * How late a block arrived against its slot's scheduled start, in seconds.
 * Negative means the header timestamp predates the schedule — a clock that
 * is ahead, which the transition tolerates within a bound.
 */
export function slotDelaySecs(block: G4Block): number {
  return block.timestamp - slotStartMs(block.slot) / 1000;
}
