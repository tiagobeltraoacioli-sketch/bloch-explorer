// SPDX-License-Identifier: AGPL-3.0-or-later
// Transaction status comes directly from the observer, independently of the
// optional historical index. An unavailable index must not hide a known TXID.
import { useEffect, useState } from "react";
import { g4rpc, G4Head } from "../lib/g4";
import { Link } from "../lib/router";
import { fmtBloch, fmtCompactBloch, fmtInt, short, timeAgo } from "../lib/format";
import { Copyable } from "../components/ui";
import { Kpi } from "../components/kit";
import { indexerHealth, indexedTransaction, IndexedTx, sumSide } from "../lib/indexer";
import { slotStartMs } from "../lib/slots";
import { OutpointCheck } from "../components/txBits";
import { TransactionStatus } from "../components/transactionStatus";
import { TxStatusLookup } from "../components/telemetry";
import "../dashboard.css";

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
  const [tx, setTx] = useState<IndexedTx | null | undefined>(hash ? undefined : null);
  useEffect(() => {
    let stop = false;
    setTx(hash ? undefined : null);
    if (hash) {
      indexerHealth()
        .then((health) => health ? indexedTransaction(hash.toLowerCase()) : null)
        .then((value) => { if (!stop) setTx(value); })
        .catch(() => { if (!stop) setTx(null); });
    }
    return () => { stop = true; };
  }, [hash]);

  if (!hash) return <div className="container">
    <h1 className="page-title">Transaction lookup</h1>
    <TxStatusLookup />
  </div>;

  return <>
    <div className="container">
      <h1 className="page-title">Transaction</h1>
      <p className="page-lede mono-wrap"><Copyable text={hash}><code className="snap-hash">{hash}</code></Copyable></p>
      <TransactionStatus key={hash} hash={hash.toLowerCase()} />
      {!tx && <section className="card">
        <h2 className="snap-h2">Transaction details</h2>
        <p>{tx === undefined ? "Checking the historical index for inputs, outputs and fees…" : "Inputs, outputs, fees and the containing block are not available from the historical index for this ID right now."}</p>
        <p className="lookup-hint">The status above is queried separately and remains available when the index is offline or does not contain this transaction.</p>
        <details><summary>Check a known output</summary><OutpointCheck seedTxid={hash} /></details>
      </section>}
    </div>
    {tx && <TxDetail tx={tx} />}
  </>;
}
