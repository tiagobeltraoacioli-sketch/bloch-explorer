// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Coin arithmetic for an entry page: what a set of unspent outputs looks like,
// and how large a balance is against the supply. Everything is BigInt; the
// only floats produced are ratios that have already been divided in integer
// space, and those are display.
//
// Ported from the wallet's insights pane, which keeps the same rule: a median
// of an even count is the FLOOR of the two middle coins — one satoshi of
// rounding, in the direction that never overstates.

export const DUST_SATS = 1000n;
const PPM = 1_000_000n;
const PPB = 1_000_000_000n;

export interface Composition {
  count: number;
  total: bigint;
  largest: bigint | null;
  smallest: bigint | null;
  median: bigint | null;
  /** Outputs below `DUST_SATS`. */
  dust: number;
  /** largest / total, parts per million. Null when total is zero. */
  largestSharePpm: bigint | null;
}

export function composition(values: (string | bigint)[]): Composition {
  const vals = values
    .map((v) => (typeof v === "bigint" ? v : /^\d+$/.test(v) ? BigInt(v) : null))
    .filter((v): v is bigint => v !== null)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = vals.length;
  if (n === 0) return { count: 0, total: 0n, largest: null, smallest: null, median: null, dust: 0, largestSharePpm: null };
  let total = 0n;
  let dust = 0;
  for (const v of vals) {
    total += v;
    if (v < DUST_SATS) dust++;
  }
  const mid = n >> 1;
  const median = n % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2n;
  const largest = vals[n - 1];
  return {
    count: n,
    total,
    largest,
    smallest: vals[0],
    median,
    dust,
    largestSharePpm: total > 0n ? (largest * PPM) / total : null,
  };
}

/** `part / whole` in parts per billion, floored. Null for an empty denominator. */
export function ppb(part: bigint, whole: bigint): bigint | null {
  if (whole <= 0n || part < 0n) return null;
  return (part * PPB) / whole;
}

/** "1.234567 ppm" from a ppb figure — six decimals, exact. */
export function ppmText(v: bigint): string {
  const whole = v / 1000n;
  const frac = (v % 1000n).toString().padStart(3, "0");
  return `${whole.toLocaleString("en-US")}.${frac} ppm`;
}

/** A percentage with two decimals from a ppb figure — "37.92%". */
export function pctText(v: bigint): string {
  const bps = v / 100_000n; // ppb → basis points ×1 (1e9 / 1e5 = 1e4)
  return `${(Number(bps) / 100).toFixed(2)}%`;
}
