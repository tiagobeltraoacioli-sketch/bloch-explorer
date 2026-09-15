// SPDX-License-Identifier: AGPL-3.0-or-later
// Live unspent status plus historical creation and spend receipts.
import { useEffect, useState } from "react";
import { g4rpc, G4Head, G4TxOut, G4_RPC } from "../lib/g4";
import { indexerHealth, indexedOutpoint, IndexedOutpoint, IndexerHealth } from "../lib/indexer";
import { fmtBloch, fmtInt } from "../lib/format";
import { Link } from "../lib/router";
import { Loading } from "../components/ui";

export function OutpointPage({ txid, vout }: { txid: string; vout: number }) {
  const [d, setD] = useState<{ out: G4TxOut; head: G4Head; endpoint: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState<IndexerHealth | null | undefined>(undefined);
  const [indexed, setIndexed] = useState<IndexedOutpoint | null>(null);

  const wellFormed = /^[0-9a-f]{64}$/.test(txid) && Number.isInteger(vout) && vout >= 0;

  useEffect(() => {
    if (!wellFormed) return;
    let stop = false;
    setD(null);
    setErr(null);
    setIndexed(null);
    (async () => {
      const head = await g4rpc<G4Head>("getchaininfo");
      const out = await g4rpc<G4TxOut>("gettxout", [txid, vout]);
      return { head, out, endpoint: G4_RPC };
    })()
      .then((r) => !stop && setD(r))
      .catch((e) => !stop && setErr(String(e?.message ?? e)));

    indexerHealth().then((h) => {
      if (stop) return;
      setIdx(h);
      if (h) indexedOutpoint(txid, vout).then((o) => !stop && setIndexed(o)).catch(() => {});
    });
    return () => {
      stop = true;
    };
  }, [txid, vout, wellFormed]);

  if (!wellFormed) {
    return (
      <div className="container">
        <h1 className="page-title">Not an outpoint</h1>
        <div className="err-box">
          An outpoint is a 64-character hex reference and a non-negative output index. Got{" "}
          <code>
            {txid}:{String(vout)}
          </code>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 className="page-title">Outpoint</h1>
      <p className="page-lede">
        <code>
          {txid}:{vout}
        </code>
        <br />
        One recorded output: its exact value, owner, creation and spend history.
        View the <Link to={`/tx/${txid}`}>creating transaction</Link>.
      </p>

      {err && <div className="err-box">{err}</div>}
      {!d && !err && <Loading label="Asking the archival…" />}

      {d && (
        <>
          <div className="g4-grid card" style={{ marginBottom: 14 }}>
            <div className="g4-stat">
              <span className="g4-k">Value</span>
              <span className="g4-v">
                {d.out.utxo || indexed ? `${fmtBloch(d.out.utxo?.value_sat ?? indexed!.value_sat, 8)} BLOCH` : "—"}
              </span>
            </div>
            <div className="g4-stat">
              <span className="g4-k">Unspent</span>
              <span className="g4-v">{d.out.unspent ? "yes" : "no"}</span>
            </div>
            <div className="g4-stat">
              <span className="g4-k">Answered at slot</span>
              <span className="g4-v">{fmtInt(d.out.at_slot)}</span>
            </div>
            <div className="g4-stat">
              <span className="g4-k">Finalized to</span>
              <span className="g4-v">{fmtInt(d.head.finalized_height)}</span>
            </div>
          </div>

          {(d.out.utxo || indexed) && (
            <section className="card">
              <h2 className="snap-h2">Owner</h2>
              <div className="bal-meta">
                <span className="g4-k">Script hash</span>
                <code className="bal-hash">
                  <Link className="mono-link" to={`/hash/${(d.out.utxo?.script_hash ?? indexed!.script_hash)}`}>
                    {(d.out.utxo?.script_hash ?? indexed!.script_hash)}
                  </Link>
                </code>
              </div>
              <p className="lookup-hint">
                {fmtInt(d.out.utxo?.value_sat ?? indexed!.value_sat)} sat. Whoever can open this hash can spend
                this output — see the entry page for the second hash the same key may also
                open.
              </p>
            </section>
          )}

          <AtSlot out={d.out} head={d.head} endpoint={d.endpoint} indexed={indexed} />
          {!d.out.unspent && <NotUnspent indexed={indexed} idx={idx} />}
          <Settlement head={d.head} out={d.out} indexed={indexed} />
        </>
      )}
    </div>
  );
}

/**
 * `at_slot` is the head, not the birthday.
 *
 * `txout_json` emits `("at_slot", Json::u(state.slot()))` on BOTH branches —
 * found and not-found. It is the point on the chain the node answered from, so
 * that the answer can be pinned; it is not the slot the output landed in, and
 * an integrator who reads it as one dates every deposit to whenever they
 * happened to ask. Measured 2026-09-01: an output created long before returned
 * `at_slot: 54570`, the head at the moment of the call.
 */
function AtSlot({
  out,
  head,
  endpoint,
  indexed,
}: {
  out: G4TxOut;
  head: G4Head;
  endpoint: string;
  indexed: IndexedOutpoint | null;
}) {
  return (
    <section className="card">
      <h2 className="snap-h2">When</h2>
      <div className="snap-digest">
        <span className="g4-k">Created in slot</span>
        <div className="bal-count">
          {indexed ? (
            <Link to={`/slot/${indexed.created_slot}`}>{fmtInt(indexed.created_slot)}</Link>
          ) : (
            "not available"
          )}
        </div>
      </div>
      <div className="snap-digest">
        <span className="g4-k">Spent in slot</span>
        <div className="bal-count">
          {indexed
            ? indexed.spent_slot != null
              ? <Link to={`/slot/${indexed.spent_slot}`}>{fmtInt(indexed.spent_slot)}</Link>
              : "unspent at the indexed snapshot"
            : "not available"}
        </div>
      </div>
      <p className="lookup-hint">
        <strong>
          <code>at_slot</code> ({fmtInt(out.at_slot)}) is not when this output was created.
        </strong>{" "}
        It is the head slot <code>{endpoint}</code> answered from — the node emits it on
        both the found and the not-found branch, so the answer can be pinned to a point on
        the chain. <code>getutxos</code> carries no slot at all.{" "}
        {indexed
          ? "The creation and spend slots above come from the indexer, which watches blocks go by; the node cannot supply them."
          : "So until the indexer is deployed, the slot an output landed in exists nowhere on this RPC, and this page says 'not available' rather than showing you a number that means something else."}{" "}
        The chain head at the time of this read was slot {fmtInt(head.slot)}, height{" "}
        {fmtInt(head.height)}.
      </p>
    </section>
  );
}

/** Why `unspent: false` is three different situations wearing one answer. */
function NotUnspent({
  indexed,
  idx,
}: {
  indexed: IndexedOutpoint | null;
  idx: IndexerHealth | null | undefined;
}) {
  if (indexed) {
    return (
      <section className="card">
        <h2 className="snap-h2">Why it is not unspent</h2>
        <p className="lookup-hint">
          The indexer has it: created in slot {fmtInt(indexed.created_slot)}
          {indexed.spent_slot != null
            ? `, spent in slot ${fmtInt(indexed.spent_slot)}.`
            : ", and no spend is recorded at the indexed snapshot. The node and index may have answered at different slots."}
        </p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2 className="snap-h2">Why it is not unspent</h2>
      <div className="warn-box">
        <span className="warn-ico">!</span>
        <div>
          The node said <code>unspent: false</code>, and on its own that sentence is
          ambiguous. The output may have been spent, may not exist on this chain,
          or the lookup may use an incorrect reference. The historical receipt
          distinguishes a known spend from an absent record.
          {idx === null
            ? "Distinguishing them needs a spend index, and no indexer is reachable. Do not read this page as 'spent'."
            : "Distinguishing them needs the indexer's spend record; it did not answer for this outpoint."}
        </div>
      </div>
    </section>
  );
}

/**
 * The settlement judgement, stated correctly.
 *
 * Two partner documents told integrators that `gettxout` returns a `finalized`
 * field and to settle on it. It does not: the response is
 * `{txid, vout, unspent, utxo, at_slot}`, five fields, and none of them is
 * finality. Finality is a property of the chain, read from `getchaininfo`.
 */
function Settlement({ head, out, indexed }: { head: G4Head; out: G4TxOut; indexed: IndexedOutpoint | null }) {
  return <section className="card">
    <h2 className="snap-h2">Finality observations</h2>
    <p className="lookup-hint">The node answered at slot {fmtInt(out.at_slot)} and reported this outpoint as {out.unspent ? "unspent" : "absent from its unspent set"}. The observed finalized height is {fmtInt(head.finalized_height)}.</p>
    {indexed && <p className="lookup-hint">The historical index records creation at height {fmtInt(indexed.created_height)}, as of slot {fmtInt(indexed.as_of_slot)}. Creation and unspent status are separate observations.</p>}
    <p className="lookup-hint">This page does not authorize deposit crediting. Confirm canonical block membership, continued finality and independent observers under the <Link to="/finality">finality policy</Link>.</p>
  </section>;
}
