// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The explorer must not answer a question it cannot answer.
//
// # The defect this pins
//
// `getbalance` answers for ANY thirty-two bytes, because a key nobody has used
// is not an error. On Genesis-4 a block id, a script hash and a transaction id
// are all thirty-two bytes. So pasting the id of a transfer you had just sent
// into `/hash/<64 hex>` — the permalink this explorer mints for every entry,
// and therefore the form that gets bookmarked and shared — rendered
// `0.00000000 BLOCH`, `Unspent outputs: 0`, under the heading "Script hash".
// Nothing errored at any step.
//
// Reproduced against both keyless archivals (139.180.166.5 and
// 139.180.173.231, port 8080), which agreed exactly:
//
//   getblockbyid  -> {"code":-32000,"message":"no block a1b2… is known to this node"}
//   getbalance    -> {"script_hash":"a1b2…","balance_sat":"0","utxo_count":0}
//
// The second line is the bug: a successful, plausible, confident, wrong answer.
// Someone checking whether their transfer arrived is told their money is not
// there.
//
// These tests run under Node's type stripping so they exercise the real
// `src/lib/resolve64.ts` the bundle ships, not a transcription of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  isZeroPaddedH160,
  isEmptyBalance,
  verdictFor,
  probeOutcome,
  isReadableBalance,
  BLOCK_NOT_FOUND_CODE,
} from '../../src/lib/resolve64.ts';

/** Read a sibling source file as text. */
function srcOf(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

/** A hash-160 padded to 32 bytes — what a `bloch1q…` address resolves to. */
const PADDED_H160 = 'a'.repeat(40) + '0'.repeat(24);
/** Shaped like the txid the archivals were probed with: no trailing zero run. */
const TXID_SHAPED = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

const EMPTY = { balance_sat: '0', utxo_count: 0 };

// ---------------------------------------------------------------- the defect

test('THE DEFECT: an empty raw 64-hex is indeterminate, never an empty address', () => {
  // This is the exact pair the two archivals returned. If this assertion ever
  // reads 'empty_address', the explorer is once again telling someone who
  // pasted a transaction id that their address holds nothing.
  assert.equal(
    verdictFor(TXID_SHAPED, EMPTY),
    'indeterminate',
    'a raw 64-hex that holds nothing establishes NOTHING: it is equally a txid, ' +
      'a block id, an unused script hash or a typo, and must not be reported as a balance',
  );
});

test('an address form that holds nothing IS a reportable answer', () => {
  // The other half of the distinction. Refusing to answer here would be its own
  // failure: the reader asked about an address and the chain answered.
  assert.equal(verdictFor(PADDED_H160, EMPTY), 'empty_address');
});

test('anything actually held settles the question, whatever the shape', () => {
  assert.equal(verdictFor(TXID_SHAPED, { balance_sat: '1', utxo_count: 1 }), 'funded');
  // Coins present but the count not yet reported, and vice versa: either is
  // evidence the key names a real entry.
  assert.equal(verdictFor(TXID_SHAPED, { balance_sat: '840000000000', utxo_count: 0 }), 'funded');
  assert.equal(verdictFor(TXID_SHAPED, { balance_sat: '0', utxo_count: 3 }), 'funded');
});

test('a balance above Number.MAX_SAFE_INTEGER is not silently mangled', () => {
  // The founder's own balance is far past 2^53. Parsing this with Number()
  // would still be non-zero here, but the habit is what matters: the module
  // uses BigInt so no comparison anywhere rounds a real balance to zero.
  const huge = { balance_sat: '3427000000000000000', utxo_count: 1 };
  assert.equal(isEmptyBalance(huge), false);
  assert.equal(verdictFor(TXID_SHAPED, huge), 'funded');
});

test('an unparseable balance is not treated as empty', () => {
  // Safe direction: the cost of guessing wrong is telling someone they have nothing.
  assert.equal(isEmptyBalance({ balance_sat: 'not-a-number', utxo_count: 0 }), false);
  assert.equal(isEmptyBalance({ balance_sat: '', utxo_count: 0 }), false);
});

// ------------------------------------------------- the padding is the evidence

test('padding detection is what separates an address from a hash', () => {
  assert.equal(isZeroPaddedH160(PADDED_H160), true);
  assert.equal(isZeroPaddedH160(TXID_SHAPED), false);
  // Eleven zero bytes is not twelve. Off-by-one here would classify real
  // script hashes as addresses.
  assert.equal(isZeroPaddedH160('a'.repeat(41) + '0'.repeat(23)), false);
  assert.equal(isZeroPaddedH160('a'.repeat(40)), false, 'a bare hash-160 is not 32 bytes');
});

test('the padding rule agrees with the one lib/scriptHash.ts already had', () => {
  // Two names for one rule — "zero-padded" here, "carried" there, because that
  // is where the shape comes from. They are separate functions in separate
  // files and only this assertion stops them drifting onto different lines,
  // which matters now that one of them decides whether a zero may be shown.
  //
  // Pinned by reading the constants rather than by importing the module:
  // `scriptHash.ts` imports `./address` and `./sha3` without file extensions,
  // which Vite resolves and Node's ESM loader does not. That is the same
  // reason `resolve64.ts` carries no imports at all.
  const src = srcOf('../../src/lib/scriptHash.ts');
  const hex = /SCRIPT_HASH_HEX\s*=\s*(\d+)/.exec(src);
  const h160 = /G3_HASH160_HEX\s*=\s*(\d+)/.exec(src);
  const tail = /CARRIED_TAIL\s*=\s*"0"\.repeat\(SCRIPT_HASH_HEX - G3_HASH160_HEX\)/.test(src);
  const rule =
    /isCarriedShape\(scriptHash: string\): boolean \{\s*return scriptHash\.length === SCRIPT_HASH_HEX && scriptHash\.endsWith\(CARRIED_TAIL\);/.test(
      src,
    );
  assert.ok(hex && h160, 'lib/scriptHash.ts no longer declares the two lengths');
  assert.ok(tail, 'CARRIED_TAIL is no longer the zero run between those two lengths');
  assert.ok(rule, 'isCarriedShape is no longer "right length, and ends with the zero run"');
  // Same length, same zero run, therefore same predicate as ours.
  assert.equal(Number(hex[1]), 64);
  assert.equal(Number(hex[1]) - Number(h160[1]), 24);
});

// ------------------------------------------------------- the swallowed catch

test('only the chain saying "no such block" licenses moving on', () => {
  // `lib/source.ts` throws `RpcRefusal` carrying the node's numeric code when a
  // node actually spoke. -32000 is the one code that means "no such block".
  assert.equal(
    probeOutcome({ message: 'no block a1b2… is known to this node', code: -32000 }),
    'not_a_block',
  );
});

test('the code this module hardcodes is still the code lib/source.ts uses', () => {
  // `resolve64.ts` restates -32000 rather than importing it, so that the module
  // keeps no imports and can be run directly under type stripping. That
  // duplication is only safe while something checks it.
  const src = readFileSync(
    fileURLToPath(new URL('../../src/lib/source.ts', import.meta.url)),
    'utf8',
  );
  const m = /BLOCK_NOT_FOUND:\s*(-?\d+)/.exec(src);
  assert.ok(m, 'CODE.BLOCK_NOT_FOUND not found in lib/source.ts');
  assert.equal(
    Number(m[1]),
    BLOCK_NOT_FOUND_CODE,
    'lib/source.ts moved BLOCK_NOT_FOUND and lib/resolve64.ts was not updated: ' +
      'every "no such block" would now be read as an endpoint fault',
  );
});

test('an endpoint fault is NOT evidence about the chain', () => {
  // Each of these would be swallowed by a bare `catch` and rendered as an empty
  // wallet. Every one says nothing whatsoever about whether the id names a
  // block. -32050 is the sharp one: it is NO_ARCHIVAL, minted by our own proxy
  // when nothing answered, and it arrives shaped exactly like a node refusal.
  for (const code of [-32050, -32001, -32005, -32006, -32007, -32601, -32603, 0]) {
    assert.equal(probeOutcome({ message: 'x', code }), 'endpoint_fault', String(code));
  }
});

test('a transport failure carrying no code at all is an endpoint fault', () => {
  // The trap: duck-typing on "does it look like an error" would file a dead
  // network under "the chain says no", the same mistake one layer down.
  assert.equal(probeOutcome(new TypeError('Failed to fetch')), 'endpoint_fault');
  assert.equal(probeOutcome(new Error('Unreachable')), 'endpoint_fault');
  assert.equal(probeOutcome(undefined), 'endpoint_fault');
  assert.equal(probeOutcome(null), 'endpoint_fault');
  assert.equal(probeOutcome('boom'), 'endpoint_fault');
  assert.equal(probeOutcome({}), 'endpoint_fault');
});

// ------------------------------------------------- an amount we cannot read

test('an unreadable amount is refused, not rounded and not zeroed', () => {
  // `lib/format.ts` `toSats` answers an unparseable amount with 0n and
  // `fmtBloch` with the string "0" from inside a bare catch — a confident wrong
  // number, the same defect one layer over, and the number that would then be
  // printed in 24-point type at the top of the entry page.
  assert.equal(isReadableBalance({ balance_sat: '0', utxo_count: 0 }), true);
  assert.equal(isReadableBalance({ balance_sat: '3427000000000000000', utxo_count: 1 }), true);
  for (const bad of ['', 'xyz', '1.5', '-1', '0x10', ' 1', '1 ', null, undefined, 12]) {
    assert.equal(isReadableBalance({ balance_sat: bad, utxo_count: 0 }), false, String(bad));
  }
});

// ------------------------------------------------------------- the wiring
//
// The tests above pin the DECISION. They say nothing about whether the page
// asks for it, and that gap is not hypothetical: removing the guard branch
// from `pages/Hash.tsx` entirely still leaves every assertion above green AND
// still leaves the panel's copy in the built bundle, because the component is
// imported and rendered from a branch that has merely become unreachable.
// Vite does not tree-shake it, so "the string is in the bundle" is not
// evidence the guard runs. Checked here at the only level that distinguishes
// them: the call site.

test('WIRING: pages/Hash.tsx actually asks for the verdict before rendering', () => {
  const src = srcOf('../../src/pages/Hash.tsx');
  assert.match(
    src,
    /verdictFor\(\s*scriptHash\s*,\s*balance\s*\)\s*===\s*"indeterminate"/,
    'the entry page no longer classifies the balance it is about to render: a raw ' +
      '64-hex holding nothing is once again shown as 0.00000000 BLOCH under "Script hash"',
  );
  assert.match(
    src,
    /isReadableBalance\(\s*balance\s*\)/,
    'the entry page no longer checks that the amount is readable before formatting it',
  );
  // The panel must REPLACE the entry view, not sit above it: leaving the
  // balance card on screen under a disclaimer keeps the confident zero.
  assert.match(
    src,
    /if\s*\(unknown\)\s*\{\s*return\s*\(/,
    'the indeterminate panel is no longer an early return, so the balance card renders too',
  );
});

test('WIRING: the search box classifies its probe through the tested rule', () => {
  const src = srcOf('../../src/components/g4search.tsx');
  assert.match(
    src,
    /probeOutcome\(e\)\s*===\s*"endpoint_fault"/,
    'g4search no longer classifies a failed getblockbyid through probeOutcome',
  );
  assert.match(
    src,
    /verdictFor\(hex,\s*bal\)\s*!==\s*"indeterminate"/,
    'g4search no longer uses the tested verdict to decide between /hash/ and /tx/',
  );
});
