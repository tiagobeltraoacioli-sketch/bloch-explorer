// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a 64-hex string pasted into the explorer actually is — and, more often,
// the admission that we cannot tell.
//
// # Why this file exists
//
// On Genesis-4 three different things are 32 bytes: a block id, a script hash,
// and a transaction id. The explorer cannot tell them apart by shape, and it
// must not pretend otherwise.
//
// The search box no longer pretends: `components/g4search.tsx` asks
// `getblockbyid`, and routes an unresolvable value to `pages/TxAnswer` rather
// than to a balance. But the search box is not the only way in. `/hash/<64
// hex>` is a real URL — it is the canonical permalink this explorer mints for
// every entry, so it is the form that gets bookmarked, pasted into a chat and
// mailed to support. Reached that way, `pages/Hash` asked `getbalance` and
// rendered whatever came back.
//
// `getbalance` answers for ANY 32 bytes; an unused key is not an error. So a
// person who pasted the id of a transfer they had just sent was shown
// `0.00000000 BLOCH`, `Unspent outputs: 0`, under the heading "Script hash",
// with nothing erroring anywhere. Verified live, both keyless archivals
// agreeing exactly:
//
//   getblockbyid -> -32000 "no block a1b2… is known to this node"
//   getbalance   -> {"script_hash":"a1b2…","balance_sat":"0","utxo_count":0}
//
// That is not a missing page — it is a confident wrong answer to the single
// most obvious question anyone asks an explorer, and the reader's honest
// reading of it is "my money is not there".
//
// So the rule here is: an all-zero balance is only reported as a balance when
// we know the input was an address. Otherwise it is reported as ignorance.
//
// This module is deliberately free of imports — no React, no fetch, no
// `./source`. That is what lets `edge/tests/hex64-verdict.test.mjs` run it
// directly under Node's type stripping, so the decision below is tested rather
// than asserted.

/**
 * True when a script hash is a 20-byte hash-160 left-aligned and zero-padded
 * to 32 bytes.
 *
 * This is the load-bearing predicate of the whole file. That padding is the
 * rule consensus applies when deciding whether a key owns an output, so a
 * padded hash is *positive evidence that the input named an address*: it can
 * only have been produced from a `bloch1…` address or from a bare hash-160.
 * Nothing derives a transaction id or a block id in that shape — a txid is
 * `SHA3-256` output and a block id is a header hash, and neither ends in
 * twelve zero bytes except by an accident with probability 2^-96.
 *
 * A raw 64-hex string carries no such evidence, which is the entire problem.
 *
 * `lib/scriptHash.ts` calls the same shape "carried", because that is where it
 * comes from — the Genesis-3 snapshot wrote it. Both names describe one rule;
 * `edge/tests/hex64-verdict.test.mjs` pins them to the same answer so the
 * tested rule and the shipped rule cannot drift onto different lines.
 */
export function isZeroPaddedH160(scriptHash: string): boolean {
  return scriptHash.length === 64 && scriptHash.slice(40) === "0".repeat(24);
}

/** A balance as the node reports it. Satoshis are decimal strings: they exceed a JS number. */
export interface BalanceLike {
  balance_sat: string;
  utxo_count: number;
}

/**
 * True when the node returned an entry holding nothing at all.
 *
 * Note the explicit digit test before the parse. `BigInt("")` is `0n` — it
 * does not throw — so a `try`/`catch` alone reads a missing or truncated field
 * as a zero balance, which is precisely the failure this file exists to
 * prevent, one layer further in. Anything that is not a run of digits is
 * refused rather than parsed: the cost of guessing wrong here is telling
 * someone their coins are gone.
 */
export function isEmptyBalance(b: BalanceLike): boolean {
  if (b.utxo_count !== 0) return false;
  if (typeof b.balance_sat !== "string" || !/^[0-9]+$/.test(b.balance_sat)) return false;
  return BigInt(b.balance_sat) === 0n;
}

/**
 * True when `balance_sat` is a value we can render exactly.
 *
 * Worth stating separately from "is it empty", because the failure modes are
 * opposite and both are bad. `lib/format.ts` `toSats` answers an unparseable
 * amount with `0n`, and `fmtBloch` answers one with the string `"0"` from
 * inside a bare `catch` — a confident wrong number, the same defect as the one
 * this module exists for, and the number that would then be printed in 24-point
 * type at the top of the entry page.
 *
 * So the caller checks first and says "the node sent something this page could
 * not read", which is true, instead of showing a zero.
 */
export function isReadableBalance(b: BalanceLike): boolean {
  return typeof b.balance_sat === "string" && /^[0-9]+$/.test(b.balance_sat);
}

/**
 * What we are entitled to say about a lookup that came back.
 *
 * `funded` and `empty_address` are answers. `indeterminate` is not an answer,
 * and the UI must not render it as one.
 */
export type Hex64Verdict = "funded" | "empty_address" | "indeterminate";

/**
 * Decide what a successful `getbalance` actually established.
 *
 * - Anything held  -> `funded`. Whatever the reader pasted, it names an entry
 *   in the ledger that holds coins; calling it a script hash is now a fact.
 * - Nothing held, but the input was an address form -> `empty_address`. A real,
 *   reportable answer: this address is empty. The reader asked about an
 *   address and gets the truth about that address.
 * - Nothing held, and the input was a raw 64-hex string -> `indeterminate`.
 *   The lookup succeeded and established NOTHING. A transaction id, a block id
 *   not in the store, an unused script hash and a typo all produce exactly this
 *   response, and we cannot rank them.
 *
 * @param scriptHash the 32-byte key actually queried
 * @param balance    what the node returned for it
 */
export function verdictFor(scriptHash: string, balance: BalanceLike): Hex64Verdict {
  if (!isEmptyBalance(balance)) return "funded";
  return isZeroPaddedH160(scriptHash) ? "empty_address" : "indeterminate";
}

/**
 * `CODE.BLOCK_NOT_FOUND` from `lib/source.ts`, restated here.
 *
 * Restated rather than imported so this module keeps no imports at all and can
 * be run directly by the test under type stripping. The duplication is pinned:
 * `edge/tests/hex64-verdict.test.mjs` reads `lib/source.ts` and fails if the
 * two numbers ever disagree.
 */
export const BLOCK_NOT_FOUND_CODE = -32000;

/**
 * Why a `getblockbyid` probe failed.
 *
 * `not_a_block` means the CHAIN answered: no block with that id is known.
 * `endpoint_fault` means we never got an answer — the proxy found no archival,
 * the archivals disagreed, the network dropped, the JSON was broken. The
 * difference is the whole point: only the first licenses moving on to a
 * balance lookup. Reading the second as "not a block" is how a dead endpoint
 * gets rendered as an empty wallet.
 */
export type ProbeOutcome = "not_a_block" | "endpoint_fault";

/**
 * Classify a thrown `getblockbyid` failure.
 *
 * `lib/source.ts` throws `RpcRefusal` (carrying the node's numeric `code`) when
 * a node actually spoke, and `Unreachable` — or a bare `TypeError` from fetch —
 * when nothing did. Only `-32000` from a real refusal means "no such block".
 *
 * `-32050` is the trap worth naming: it is `NO_ARCHIVAL`, minted by our own
 * proxy when no archival answered at all. It arrives shaped exactly like a node
 * refusal, `code` and all, and treating "it has a code" as "the chain spoke"
 * would file a total outage under "the chain says no" — the same class of
 * mistake this module exists to remove. Hence an equality test on the one code
 * that means what we need, rather than any test for the presence of a code.
 */
export function probeOutcome(err: unknown): ProbeOutcome {
  if (!err || typeof err !== "object") return "endpoint_fault";
  if (!("code" in err)) return "endpoint_fault";
  return (err as { code: unknown }).code === BLOCK_NOT_FOUND_CODE ? "not_a_block" : "endpoint_fault";
}
