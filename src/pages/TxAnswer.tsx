// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "I pasted a transaction hash and got nothing."
//
// Somebody will do this on their first visit, and they will be right to. Every
// wallet and every exchange integration hands the user a transaction hash,
// because `sendrawtransaction` returns one. On every other chain they have
// used, pasting it into an explorer is *the* thing an explorer is for.
//
// Here it resolves to nothing, and the three obvious ways to handle that are
// all worse than telling the truth:
//
//   * A 404 is a lie by omission. It reads as "not found yet" — try again
//     later — when the correct answer is "this can never be found, and here is
//     what to do instead". The person retries for an hour.
//
//   * Pretending to find it is worse. `gettxout` accepts any 32 bytes and
//     answers `{"unspent": false, "utxo": null}` with HTTP 200 and no error
//     for a value that has never existed — verified live against the archivals
//     with a hash of nothing but `ab` repeated. That answer is byte-identical
//     to the one a spent output gives and to the one a withdrawal that was
//     silently dropped gives. An explorer that renders it as "spent" or
//     "confirmed" is manufacturing a settlement claim out of noise.
//
//   * Silence about `sendrawtransaction`'s return value leaves the trap armed.
//     The hash it returns is computed by the node that received the
//     transaction and is not agreed on by any other node, so it is not even a
//     stable local handle.
//
// So this page says what the value is, demonstrates the trap on the reader's
// own input rather than describing it, and routes them to the two lookups that
// are exact.

import { useEffect, useState } from "react";
import { read } from "../lib/source";
import { g4rpc, G4Head } from "../lib/g4";
import { Link } from "../lib/router";
import { fmtBloch, fmtCompactBloch, fmtInt, short, timeAgo } from "../lib/format";
import { Copyable, Loading } from "../components/ui";
import { Kpi } from "../components/kit";
import { indexerHealth, indexedTransaction, IndexedTx, sumSide } from "../lib/indexer";
import { slotStartMs } from "../lib/slots";
import { OutpointCheck } from "../components/txBits";
import "../dashboard.css";

interface TxOut {
  txid: string;
  vout: number;
  unspent: boolean;
  utxo: unknown | null;
  at_slot: number;
}

/**
 * The live demonstration.
 *
 * Showing the reader the exact JSON the node returns for *their* hash is worth
 * more than any amount of prose about it, because the point is precisely that
 * the response looks fine. Prose saying "this answer is meaningless" is easy
 * to skim past; the same claim next to a well-formed `"unspent": false` that
 * the reader can see is about their own value is not.
 */
function TrapDemo({ hash }: { hash: string }) {
  const [out, setOut] = useState<TxOut | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    read<TxOut>("gettxout", [hash, 0])
      .then((r) => !stop && setOut(r))
      .catch((e) => !stop && setErr(String(e?.message ?? e)));
    return () => {
      stop = true;
    };
  }, [hash]);

  if (err) return <p className="lookup-hint">The archivals did not answer: {err}</p>;
  if (!out) return <p className="lookup-hint">Asking the chain about your value…</p>;

  return (
    <>
      <p className="page-lede">
        Here is what <code>gettxout</code> actually returns for the value you pasted, right now,
        from a live archival:
      </p>
      <pre className="code-block">
        {JSON.stringify(
          { txid: out.txid, vout: out.vout, unspent: out.unspent, utxo: out.utxo, at_slot: out.at_slot },
          null,
          2,
        )}
      </pre>
      <p className="page-lede">
        <strong>That is not a finding.</strong> No error, HTTP 200, a well-formed answer — and it
        would be exactly the same if you had pasted 32 bytes of nothing. It means only "the eUTXO
        set has no unspent output under this key at slot {fmtInt(out.at_slot)}", which is true of
        essentially every 32-byte number. It does not distinguish
        {" "}<em>never existed</em> from <em>existed and was spent</em> from{" "}
        <em>a withdrawal that was dropped</em>. Anything that reads this response as a
        confirmation is inventing one.
      </p>
    </>
  );
}

/**
 * A transaction the indexer knows: the one case where a transaction id DOES
 * get a page. Everything here is the indexer's, labelled as of the slot it had
 * folded, and the settlement judgement is made against the chain head read
 * separately — the indexer says where the transaction landed, the chain says
 * whether that place is finalized right now.
 */
function TxDetail({ tx }: { tx: IndexedTx }) {
  const [head, setHead] = useState<G4Head | null>(null);
  useEffect(() => {
    let stop = false;
    g4rpc<G4Head>("getchaininfo").then((h) => !stop && setHead(h)).catch(() => {});
    return () => {
      stop = true;
    };
  }, [tx.txid]);
  const inSum = sumSide(tx.inputs);
  const outSum = sumSide(tx.outputs);
  const fee = /^[0-9]+$/.test(tx.fee_sat) ? BigInt(tx.fee_sat) : null;
  const feeChecks = inSum !== null && outSum !== null && fee !== null && inSum - outSum === fee;
  const finalHeight = head?.finalized_height ?? null;
  const settled = finalHeight !== null && tx.height <= finalHeight;

  return (
    <div className="container">
      <h1 className="page-title">
        Transaction <span className="pill quiet">{tx.kind}</span>
      </h1>
      <p className="page-lede mono-wrap">
        <Copyable text={tx.txid}>
          <code className="snap-hash">{tx.txid}</code>
        </Copyable>
      </p>
      <p className="page-lede">
        Carried by the block at <Link to={`/slot/${tx.slot}`}>slot {fmtInt(tx.slot)}</Link>, height{" "}
        {fmtInt(tx.height)}, as transaction {fmtInt(tx.index + 1)} of its body,{" "}
        {timeAgo(slotStartMs(tx.slot) / 1000)}. This is the indexer's reading of the block body;
        the chain itself serves no transaction by id.
      </p>

      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <Kpi k="Moved" v={outSum === null ? "unreadable" : fmtCompactBloch(outSum)} unit={outSum === null ? undefined : "BLOCH"} tone={outSum === null ? "absent" : "accent"} sub={outSum === null ? "an amount this page could not parse exactly" : `${fmtBloch(outSum, 8)} BLOCH · ${fmtInt(outSum)} sat across ${fmtInt(tx.outputs.length)} outputs`} />
        <Kpi k="Fee" v={fee === null ? "—" : fmtInt(fee)} unit={fee === null ? undefined : "sat"} sub={feeChecks ? "inputs − outputs, exactly — what consensus checks with !=" : inSum === null || outSum === null ? "sides not fully readable" : "does NOT equal inputs − outputs as indexed"} />
        <Kpi k="Inputs → outputs" v={`${fmtInt(tx.inputs.length)} → ${fmtInt(tx.outputs.length)}`} sub={inSum === null ? undefined : `${fmtBloch(inSum, 4)} BLOCH spent in`} />
        <Kpi k="Size" v={fmtInt(tx.size_bytes)} unit="B" sub="encoded bytes — a Falcon signature is variable length" />
        <Kpi k="Block" v={<Link to={`/block/${tx.block_id}`} className="mono-link">{short(tx.block_id, 10, 6)}</Link>} sub={`slot ${fmtInt(tx.slot)} · height ${fmtInt(tx.height)}`} />
        <Kpi
          k="Settled?"
          v={head ? (settled ? "finalized" : "not yet") : "—"}
          tone={head && !settled ? "warn" : undefined}
          sub={head ? `chain finalized to height ${fmtInt(head.finalized_height)} · a reading, not a latch` : "reading the head…"}
        />
      </div>

      <div className="tx-io">
        <section className="card" style={{ margin: 0 }}>
          <h2 className="snap-h2">Inputs — {fmtInt(tx.inputs.length)}</h2>
          {tx.inputs.length === 0 ? (
            <p className="lookup-hint">No inputs: this variant mints or moves nothing from the unspent set.</p>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Outpoint spent</th><th>From</th><th className="num">Value</th></tr></thead>
                <tbody>
                  {tx.inputs.map((i, n) => (
                    <tr key={n}>
                      <td>{i.txid ? <Link to={`/outpoint/${i.txid}:${i.vout}`} className="mono-link">{short(i.txid, 8, 6)}:{i.vout}</Link> : <span className="faint">—</span>}</td>
                      <td><Link to={`/hash/${i.script_hash}`} className="mono-link">{short(i.script_hash, 8, 6)}</Link></td>
                      <td className="num">{/^[0-9]+$/.test(i.value_sat) ? fmtBloch(i.value_sat, 8) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <div className="tx-io-arrow" aria-hidden="true">→</div>
        <section className="card" style={{ margin: 0 }}>
          <h2 className="snap-h2">Outputs — {fmtInt(tx.outputs.length)}</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th className="num">#</th><th>To</th><th className="num">Value</th><th>Now</th></tr></thead>
              <tbody>
                {tx.outputs.map((o) => (
                  <tr key={o.vout}>
                    <td className="num">{o.vout}</td>
                    <td><Link to={`/hash/${o.script_hash}`} className="mono-link">{short(o.script_hash, 8, 6)}</Link></td>
                    <td className="num">{/^[0-9]+$/.test(o.value_sat) ? fmtBloch(o.value_sat, 8) : "—"}</td>
                    <td><Link to={`/outpoint/${tx.txid}:${o.vout}`}>check</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h2 className="snap-h2">What this page is, and is not</h2>
        <p className="snap-body">
          The id above is the consensus id, <code>SHA3-256(DS_TXID ‖ spend_signing_root)</code>, taken
          over the witness-free root. It is <strong>not</strong> the <code>tx_hash</code> that{" "}
          <code>sendrawtransaction</code> returns, which is computed by the node you talked to and
          agreed on by no other. If a wallet handed you an id and this page found it, the wallet
          reported the consensus id; if it did not, see the explanation the page gives instead.
        </p>
        <p className="snap-body" style={{ marginBottom: 0 }}>
          "Settled" above compares the carrying block's height with the chain's finalized height
          right now. On this chain a finalized checkpoint is not a latch and can move down; treat the
          verdict as evidence with a timestamp, re-read before releasing value, and{" "}
          <Link to="/finality">read what the guarantee is worth</Link>.
        </p>
      </section>
    </div>
  );
}

export function TxAnswerPage({ hash }: { hash?: string }) {
  // The indexer is probed first, once. A hit is the one case this page can
  // answer with a transaction; a miss falls through to the explanation, which
  // stays exactly as it was — the miss is the common case and the reason the
  // explanation exists.
  const [tx, setTx] = useState<IndexedTx | null | undefined>(hash ? undefined : null);
  useEffect(() => {
    let stop = false;
    if (!hash) {
      setTx(null);
      return;
    }
    setTx(undefined);
    indexerHealth()
      .then((h) => (h ? indexedTransaction(hash.toLowerCase()) : null))
      .then((t) => !stop && setTx(t))
      .catch(() => !stop && setTx(null));
    return () => {
      stop = true;
    };
  }, [hash]);

  if (hash && tx === undefined) return <Loading label="Asking whether an indexer knows this id…" />;
  if (tx) return <TxDetail tx={tx} />;

  return (
    <div className="container">
      <h1 className="page-title">A transaction id does not get you a page here</h1>

      {hash && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p className="page-lede">
            You searched for{" "}
            <Copyable text={hash}>
              <code className="snap-hash">{hash}</code>
            </Copyable>
          </p>
          <p className="page-lede">
            If a wallet or an exchange gave you this, it came from{" "}
            <code>sendrawtransaction</code>, which returns a <code>tx_hash</code> computed by the
            node that accepted your transaction. <strong>Other nodes do not agree on it.</strong>{" "}
            It is not a network-wide identifier, it is not recorded in any block, and there is
            nothing to look it up in.
          </p>
          <TrapDemo hash={hash} />
          <div style={{ marginTop: 14 }}>
            <OutpointCheck seedTxid={hash} />
          </div>
        </div>
      )}

      <section className="card">
        <h2 className="snap-h2">Why the lookup does not exist</h2>
        <p className="page-lede">
          <code>gettransaction</code> is not missing from this build; it is{" "}
          <strong>refused on purpose and permanently</strong>, with its own error code
          (<code>-32005</code>) rather than "method not found", specifically so that nobody goes
          looking for a newer node that has it. The node's own words:
        </p>
        <blockquote className="node-quote">
          this node cannot look up a transaction by id: at Genesis-4's current layer a transaction
          carries no id (the transfer format is not yet specified — <code>PosTransaction::Transfer</code>{" "}
          encodes only fee-market terms), and the block store keeps no txid index. Track deposits by
          scanning blocks via <code>getblockbyslot</code> and reading the eUTXO set via{" "}
          <code>getbalance</code> / <code>listunspent</code>, both of which are exact. This is a
          permanent answer for this build, not a transient failure — do not retry.
        </blockquote>
        <p className="lookup-hint">
          <strong>One half of that quote is wrong, and it is the node's error, not ours.</strong>{" "}
          A Genesis-4 transaction <em>does</em> have an id: consensus computes{" "}
          <code>txid = SHA3-256(DS_TXID ‖ spend_signing_root)</code> —{" "}
          <code>PosTransaction::txid</code> in{" "}
          <code>bloch-pos-committee/src/transition.rs</code> — taken over the witness-free root
          precisely so that re-encoding the signatures cannot move it, and with it the key of every
          output the transfer creates.
        </p>
        <p className="lookup-hint">
          What is missing is the <strong>index</strong>. Nothing maps that id back to the block that
          carried it, and the node exposes no transaction list for a block, so a block page can tell
          you a block carries <code>tx_count: 3</code> and cannot tell you which three. The refusal
          is therefore correct and permanent even though its wording is not — and it is still not the
          identifier your wallet handed you, which is the separate trap above. The remedy is the same
          either way: the lookups below do not need an id at all.
        </p>
      </section>

      <section className="card">
        <h2 className="snap-h2">What to do instead</h2>
        <p className="page-lede">
          Both of these are exact. Neither needs a transaction id, because the ledger is keyed by
          output, not by transaction.
        </p>
        <ol className="how-list">
          <li>
            <strong>Look up the recipient, not the transfer.</strong> Genesis-4 keys the eUTXO set
            by <em>script hash</em> — 32 bytes, no address encoding at consensus level. A{" "}
            <Link to="/balance">balance lookup</Link> gives you the exact holdings and the
            individual unspent outputs. If you hold a <code>bloch1q…</code> address, or the bare
            20-byte hash a carried Genesis-3 balance uses, the search box converts either into the
            32-byte key consensus actually compares — a 20-byte hash is left-aligned and
            zero-padded, which is the identity rule, not a convenience.
          </li>
          <li>
            <strong>Watch the slots.</strong> If you know roughly when a transfer should have
            landed, <Link to="/blocks">walk the range</Link> and look for the blocks with a
            non-zero transaction count. Combined with a balance reading before and after, that
            brackets it.
          </li>
          <li>
            <strong>If you have an outpoint</strong> — a 32-byte id and an output index — the
            search box accepts <code>&lt;hash&gt;:&lt;n&gt;</code> and asks{" "}
            <code>gettxout</code> directly. Read the answer with the caveat above firmly in mind:{" "}
            <code>unspent: false</code> is not evidence of anything.
          </li>
        </ol>
      </section>

      <section className="card">
        <h2 className="snap-h2">If you are integrating</h2>
        <p className="page-lede">
          Do not build a deposit flow that tracks transactions by id — there is no id to track,
          and the <code>tx_hash</code> your node hands back will not survive being asked of a
          different node. Credit against the eUTXO set: read{" "}
          <code>getbalance</code> / <code>listunspent</code> for the script hash you issued, from
          two independent nodes, and require them to agree on the finalized root <em>and</em>{" "}
          epoch before you release funds. Add a margin past finality; the checkpoint is not a
          latch and can move backwards.
        </p>
      </section>
    </div>
  );
}
