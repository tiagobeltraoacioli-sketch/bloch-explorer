// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the explorer says when it does not know what it was handed.
//
// One component, so the entry page and anything else that resolves a 32-byte
// value cannot drift into telling a reader different stories about the same
// string.
import { Link } from "../lib/router";

/**
 * The 64-hex input established nothing.
 *
 * Rendered INSTEAD of a balance, never beside one. The whole point is that
 * there is no number on this screen for the reader to take away.
 */
export function Hex64Indeterminate({ hex }: { hex: string }) {
  return (
    <section className="card">
      <h2 className="hex64-title">We cannot tell you what this is</h2>

      <code className="bal-hash hex64-subject">{hex}</code>

      <p className="hex64-lede">
        Sixty-four hex characters is thirty-two bytes, and on Genesis-4 three different things are
        thirty-two bytes: a <strong>block id</strong>, a <strong>script hash</strong> (what an
        address resolves to), and a <strong>transaction id</strong>. Nothing about the string itself
        says which one you pasted.
      </p>

      <p className="hex64-lede">
        We asked the chain both questions we can ask. No block with this id is known. The ledger
        holds nothing under this key. Neither of those answers makes it an address — an unused
        script hash, a transaction id and a mistyped character all produce exactly this result, and
        we cannot rank them.
      </p>

      <p className="hex64-lede">
        So this page is deliberately not showing you a balance of zero. It would have been a real
        number, formatted and confident, and it would have meant nothing.
      </p>

      <h3 className="hex64-h3">If you meant an address</h3>
      <p className="hex64-lede">
        Paste the <code>bloch1q…</code> address itself rather than a bare hash. The checksum is
        verified before anything is asked of the chain, so a typo is refused instead of being
        answered with an empty balance — and a balance of zero shown for a real address is then a
        fact you can rely on. If you pasted this script hash on purpose and it is genuinely yours,
        it currently holds no unspent outputs.
      </p>

      <h3 className="hex64-h3">If you meant a transaction</h3>
      <p className="hex64-lede">
        A Genesis-4 transaction <em>does</em> have an id — consensus computes{" "}
        <code>txid = SHA3-256(DS_TXID ‖ spend_signing_root)</code>, taken over the witness-free root
        so that re-encoding the signatures cannot move it. What does not exist is any{" "}
        <strong>index from that id back to the block that carried it</strong>, which is why{" "}
        <code>gettransaction</code> is a permanent refusal rather than a lookup that is merely
        failing today. <Link to={`/tx/${hex}`}>The transaction page</Link> has the full answer,
        including what the hash your wallet handed you actually is.
      </p>

      <h3 className="hex64-h3">How to check a transfer instead</h3>
      <p className="hex64-lede">
        Track it by <strong>outpoint and by balance</strong>, both of which are exact. Look up the
        receiving address here: when the transfer has been applied, the coins are in its unspent
        outputs, and the outpoint the transfer created is listed against it. That is the same eUTXO
        set consensus itself decides ownership from, so it is the stronger evidence anyway — a
        transaction id only tells you something was sent, while the balance tells you it arrived.
      </p>
    </section>
  );
}

/**
 * The endpoint could not answer at all.
 *
 * Distinct from the panel above on purpose. "We do not know what this string
 * is" is a statement about the string; this is a statement about the explorer,
 * and the reader must not read one as the other — nothing here says anything
 * about Genesis-4, which may be finalising normally the whole time.
 */
export function Hex64Unavailable({ hex, message }: { hex: string; message: string }) {
  return (
    <div className="warn-box">
      <span className="warn-ico" aria-hidden="true">
        !
      </span>
      <div>
        <strong>This lookup did not complete.</strong> We could not find out what{" "}
        <code>{hex.slice(0, 16)}…</code> is, because the endpoint behind this page did not answer —
        not because the chain said no. Nothing on this screen is a statement about Genesis-4, and
        your transfer is not affected either way. Try again in a moment.
        <div className="hex64-detail">{message}</div>
      </div>
    </div>
  );
}
