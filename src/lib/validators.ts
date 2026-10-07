// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The validator set, as a thing the browser can hold.
//
// READ PATH, AND WHY IT IS NOT THE OBVIOUS ONE
//
// Genesis-4 answers `getvalidator` for one index at a time and has no listing
// method. The direct translation of that into a web page — the browser loops
// over 64 indices — is what this module exists to avoid. The node's RPC has no
// auth and no rate limit and shares a thread with consensus, so that loop is
// an unauthenticated amplifier aimed at block production, once per reader.
//
// Instead the fan-out happens once, at the edge, against the two keyless
// ARCHIVAL nodes (functions/g4/validators.js), and is cached there. This file
// only pages through the result. The distinction that matters is not "fewer
// requests" but "no request from this page ever reaches something that
// proposes a block".
//
// The page size is 32 because a Pages Function has a 50-subrequest budget and
// 64 + a head read does not fit. That is a platform fact, so it lives in one
// place and both sides agree on it.

import { G4Validator } from "./g4";

/** Matches `MAX_LIMIT` in functions/g4/validators.js. */
const PAGE = 32;

/** Where a browser reads the set. Same origin — the Pages Function. */
const SET_ENDPOINT = "/g4/validators";

/**
 * A validator index the aggregator could not read this round.
 *
 * Present as a row rather than dropped, because a missing index and a
 * validator that does not exist look identical once you filter, and only one
 * of those is alarming.
 */
export interface ValidatorGap {
  index: number;
  unavailable: string;
}

export type ValidatorRow = G4Validator | ValidatorGap;

export function isGap(v: ValidatorRow): v is ValidatorGap {
  return (v as ValidatorGap).unavailable !== undefined;
}

export interface ValidatorSetHead {
  slot: number;
  height: number;
  epoch: number;
  slot_in_epoch: number;
  slots_per_epoch: number;
  finalized_height: number;
  justified: { epoch: number; root: string };
  finalized: { epoch: number; root: string };
  block_id: string;
  state_root: string;
}

export interface Corroboration {
  /** "corroborated" | "conflict" | "single" */
  state: string;
  /** Finality fields the two archivals disagreed on. Empty when they agree. */
  differing: string[];
  sources: {
    url: string;
    ok: boolean;
    ms: number;
    error?: string;
    claim?: {
      slot: number;
      height: number;
      justified_epoch: number;
      justified_root: string;
      finalized_epoch: number;
      finalized_root: string;
    };
  }[];
}

export interface ValidatorSet {
  head: ValidatorSetHead;
  counts: { total: number; active: number; total_active_stake_sat: string };
  validators: ValidatorRow[];
  /** Which archival answered, for the provenance line. */
  source: string;
  /**
   * Whether the second archival agreed about finality.
   *
   * Rendering a `conflict` is not optional. The archivals run a different
   * binary from the validator fleet, and reading them on :8080 bypasses the
   * public proxy entirely — so a disagreement is the only local evidence that
   * a number below might be from a forked node, and hiding it would leave the
   * reader with the number and none of the doubt.
   */
  corroboration?: Corroboration;
  /** Unix seconds the edge assembled this from. */
  generatedAt: number;
  /** True when the edge served it from cache rather than re-reading. */
  cached: boolean;
}

interface PageBody {
  head: ValidatorSetHead;
  counts: { total: number; active: number; total_active_stake_sat: string };
  offset: number;
  limit: number;
  returned: number;
  validators: ValidatorRow[];
  source: string;
  corroboration?: Corroboration;
  generated_at: number;
  error?: string;
}

async function fetchPage(offset: number): Promise<{ body: PageBody; cached: boolean }> {
  const res = await fetch(`${SET_ENDPOINT}?offset=${offset}&limit=${PAGE}`, {
    headers: { accept: "application/json" },
  });
  const cached = res.headers.get("x-bloch-cache") === "hit";
  let body: PageBody;
  try {
    body = await res.json();
  } catch {
    throw new Error(`validator set endpoint returned a non-JSON body (HTTP ${res.status})`);
  }
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `validator set endpoint failed (HTTP ${res.status})`);
  }
  return { body, cached };
}

/**
 * The whole set, assembled from as many pages as the registry needs.
 *
 * Pages are fetched in SEQUENCE, not in parallel. Two pages at once would
 * double the cold-cache load on the archivals for a page a reader is going to
 * spend a minute looking at — the latency saved is not worth spending someone
 * else's node on.
 */
export async function fetchValidatorSet(): Promise<ValidatorSet> {
  const first = await fetchPage(0);
  const total = first.body.counts.total;
  const validators = first.body.validators.slice();
  let cached = first.cached;

  for (let offset = PAGE; offset < total; offset += PAGE) {
    const next = await fetchPage(offset);
    validators.push(...next.body.validators);
    cached = cached && next.cached;
  }

  validators.sort((a, b) => a.index - b.index);

  return {
    head: first.body.head,
    counts: first.body.counts,
    validators,
    source: first.body.source,
    corroboration: first.body.corroboration,
    generatedAt: first.body.generated_at,
    cached,
  };
}

// ---------------------------------------------------------------------------
// TWO TOTALS THAT ARE NOT THE SAME NUMBER — read this before comparing them.
//
// `counts.total_active_stake_sat`, which arrives on `getchaininfo`, is summed
// over the PRE-leak duty roster. The `effective_stake_sat` on each validator
// record is read from the POST-leak consensus roster. On the live chain those
// differ by more than half, so:
//
//     effective_stake_sat / total_active_stake_sat
//
// is a ratio of a leaked numerator to an unleaked denominator, and it
// understates every validator's share of consensus weight by roughly the
// fleet's leak fraction. The node's own source flags the same trap on the
// other side: reading the total after the leak "would silently answer a
// different (smaller) question".
//
// The rule this module follows: a share of CONSENSUS WEIGHT is always taken
// against `stakeShares().total`, which is summed from the same post-leak
// records as its numerator. `total_active_stake_sat` is used only where the
// pre-leak basis is the correct one — notably the cohort cap, which consensus
// applies to the pre-leak roster.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Derived readings.
//
// Everything below is arithmetic over the rows above. Nothing here invents a
// figure the chain did not supply; where a number cannot be derived from what
// the node serves today, the page says so instead of estimating.
// ---------------------------------------------------------------------------

export interface StakeShare {
  index: number;
  effective: bigint;
  /** Share of total effective stake, 0..1. */
  share: number;
}

/** Effective stake per validator, largest first, with each one's share. */
export function stakeShares(rows: ValidatorRow[]): { shares: StakeShare[]; total: bigint } {
  // A validator the roster does not carry has no share of consensus weight,
  // and is dropped rather than counted as zero: including it would put a row
  // with no weight into the Nakamoto count and make the chain look one
  // operator more distributed than it is.
  const live = rows.filter(
    (r): r is G4Validator => !isGap(r) && r.effective_stake_sat !== null,
  );
  const total = live.reduce((acc, v) => acc + BigInt(v.effective_stake_sat!), 0n);
  const shares = live
    .map((v) => {
      const effective = BigInt(v.effective_stake_sat!);
      return {
        index: v.index,
        effective,
        // Ratio of two bigints via a scaled division: never route a satoshi
        // value through Number() (see lib/format.ts), but a RATIO is safely a
        // float once the division has already happened in integer space.
        share: total === 0n ? 0 : Number((effective * 1_000_000n) / total) / 1_000_000,
      };
    })
    .sort((a, b) => (b.effective > a.effective ? 1 : b.effective < a.effective ? -1 : 0));
  return { shares, total };
}

/**
 * How many of the largest validators it takes to reach `fraction` of stake.
 *
 * The honest measure of a stake-weighted chain: finality needs two thirds, so
 * the count that reaches one third is the number of operators who could
 * withhold it, and the count that reaches two thirds is the number who could
 * finalise on their own.
 */
export function stakeToReach(shares: StakeShare[], total: bigint, fraction: number): number {
  if (total === 0n) return 0;
  let acc = 0n;
  const target = (total * BigInt(Math.round(fraction * 1_000_000))) / 1_000_000n;
  for (let i = 0; i < shares.length; i++) {
    acc += shares[i].effective;
    if (acc >= target) return i + 1;
  }
  return shares.length;
}

/** Nakamoto coefficient for finality: operators needed to block two thirds. */
export function nakamotoCoefficient(shares: StakeShare[], total: bigint): number {
  // Blocking finality needs strictly more than one third of the weight.
  return stakeToReach(shares, total, 1 / 3);
}

export interface StateTally {
  state: string;
  count: number;
  stake: bigint;
}

/** Group the set by the node's own `state` word — never a word of our own. */
export function tallyByState(rows: ValidatorRow[]): StateTally[] {
  const by = new Map<string, StateTally>();
  for (const r of rows) {
    const state = isGap(r) ? "unread" : r.state;
    const stake = isGap(r) || r.effective_stake_sat === null ? 0n : BigInt(r.effective_stake_sat);
    const cur = by.get(state) ?? { state, count: 0, stake: 0n };
    cur.count += 1;
    cur.stake += stake;
    by.set(state, cur);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/**
 * The genesis cohort: the validators registered in the genesis block.
 *
 * `genesis_cohort.rs` caps their COMBINED consensus weight at a share of the
 * total that tapers from 100% to 33.33% over a year. It is identified here by
 * activation epoch 0, which no deposit made after genesis can have.
 */
export function isGenesisCohort(v: G4Validator): boolean {
  return v.activation_epoch === 0;
}

/**
 * The factor the cohort cap currently scales every cohort member by, 0..1.
 *
 * Consensus scales the cohort pro-rata (`apply_cohort_cap`), so every member
 * without delegated stake carries the same effective/own ratio. The node does
 * not serve the factor, so it is read back as the MEDIAN of that ratio across
 * the cohort: a member with delegations sits above it, and one that has also
 * leaked sits below it, and neither moves the median. 1 when the cap does not
 * bind (or the roster has no cohort members).
 */
export function cohortScale(rows: ValidatorRow[]): number {
  const ratios = rows
    .filter((r): r is G4Validator => !isGap(r) && isGenesisCohort(r) && r.effective_stake_sat !== null)
    .filter((v) => BigInt(v.own_stake_sat) > 0n)
    .map((v) => Number((BigInt(v.effective_stake_sat!) * 1_000_000n) / BigInt(v.own_stake_sat)) / 1_000_000)
    .sort((a, b) => a - b);
  if (!ratios.length) return 1;
  return Math.min(1, ratios[Math.floor(ratios.length / 2)]);
}

/** A cohort member's own stake after the cohort cap, before any leak. */
function cappedOwn(v: G4Validator, scale: number): bigint {
  const own = BigInt(v.own_stake_sat);
  if (!isGenesisCohort(v) || scale >= 1) return own;
  return (own * BigInt(Math.round(scale * 1_000_000))) / 1_000_000n;
}

/**
 * Weight the genesis-cohort cap is holding back from this validator.
 *
 * A protocol rule, not a penalty: own stake (the bond, which keeps earning and
 * is what a withdrawal pays) is untouched; only the share of consensus weight
 * it carries is scaled down, identically for every cohort member. Zero for
 * validators outside the cohort.
 */
export function cohortCapSat(v: G4Validator, scale: number): bigint {
  return BigInt(v.own_stake_sat) - cappedOwn(v, scale);
}

/**
 * Weight a validator has lost to the inactivity leak.
 *
 * `effective_stake_sat` is the roster weight after the cohort cap and after
 * `with_leak_applied`. The leak is what is missing on top of the cap: for a
 * cohort member, the capped own stake minus the effective stake; for anyone
 * else, own minus effective. Delegated stake raises effective weight, so a
 * delegated validator can show zero here while having leaked a little — this
 * reading never overstates the leak.
 *
 * The leak only runs after more than `INACTIVITY_LEAK_THRESHOLD_EPOCHS` epochs
 * without finality, only against validators that did not vote, and it never
 * debits the bond (`staked_sat`).
 *
 * Returns null when the node reported no effective stake at all, which means
 * "not in the active roster this epoch" and is a different statement from
 * zero weight.
 */
export function leakedSat(v: G4Validator, scale = 1): bigint | null {
  if (v.effective_stake_sat === null || v.effective_stake_sat === undefined) return null;
  const capped = cappedOwn(v, scale);
  const eff = BigInt(v.effective_stake_sat);
  return capped > eff ? capped - eff : 0n;
}

/** Fraction of its own bond's weight a validator has lost to the leak, 0..1. */
export function leakedFraction(v: G4Validator, scale = 1): number | null {
  const lost = leakedSat(v, scale);
  if (lost === null) return null;
  const own = BigInt(v.own_stake_sat);
  if (own === 0n) return null;
  return Number((lost * 1_000_000n) / own) / 1_000_000;
}

export interface Quantiles {
  p50: bigint;
  p90: bigint;
  p99: bigint;
  max: bigint;
  min: bigint;
}

/**
 * Stake quantiles over the set.
 *
 * Named to match `getstakedistribution` as specified in
 * `docs/specs/BLOCH-RPC-STABILITY-V4.md` §5.3, so that when the node grows
 * that method this page can read it instead of computing it, without any of
 * these numbers changing meaning on the way.
 */
export function quantiles(shares: StakeShare[]): Quantiles | null {
  if (shares.length === 0) return null;
  // `shares` arrives largest-first; quantiles want ascending.
  const asc = [...shares].map((s) => s.effective).reverse();
  const at = (q: number) => asc[Math.min(asc.length - 1, Math.floor(q * (asc.length - 1)))];
  return { p50: at(0.5), p90: at(0.9), p99: at(0.99), max: asc[asc.length - 1], min: asc[0] };
}

/**
 * Gini coefficient of effective stake, in basis points.
 *
 * WHAT IT MEASURES, AND THE DISCLAIMER THAT TRAVELS WITH IT: this is
 * inequality between validator INDICES, not between operators. Every one of
 * the 64 genesis validators is funded and run by the same party and shares one
 * withdrawal address, so the honest reading of a low Gini here is "the founder
 * spread its own stake evenly across its own validators", not "the chain is
 * decentralised". The spec calls the same trap out by naming its field
 * `measures: "stake_by_validator_index"`; this function keeps that framing.
 */
export function giniBps(shares: StakeShare[]): number {
  const n = shares.length;
  if (n === 0) return 0;
  const asc = [...shares].map((s) => s.effective).sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  const total = asc.reduce((a, b) => a + b, 0n);
  if (total === 0n) return 0;
  // sum_i (2i - n + 1) * x_i  /  (n * total)
  let weighted = 0n;
  for (let i = 0; i < n; i++) weighted += BigInt(2 * i - n + 1) * asc[i];
  const bps = (weighted * 10_000n) / (BigInt(n) * total);
  return Number(bps);
}
