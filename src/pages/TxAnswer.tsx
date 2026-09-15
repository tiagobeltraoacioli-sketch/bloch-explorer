// SPDX-License-Identifier: AGPL-3.0-or-later
// Transaction status comes directly from the observer, independently of the
// optional historical index. An unavailable index must not hide a known TXID.
import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { fmtBloch, fmtCompactBloch, fmtInt, short, timeAgo } from "../lib/format";
import { Copyable } from "../components/ui";
import { Kpi } from "../components/kit";
import { indexerHealth, indexedTransaction, IndexedTxAmbiguity, IndexedTx, sumSide } from "../lib/indexer";
import { slotStartMs } from "../lib/slots";
import { OutpointCheck } from "../components/txBits";
import { TransactionStatus } from "../components/transactionStatus";
import { TxStatusLookup } from "../components/telemetry";
import "../dashboard.css";

function TxDetail({ tx }: { tx: IndexedTx }) {
  const inSum = sumSide(tx.inputs);
  const outSum = sumSide(tx.outputs);
  const fee = typeof tx.fee_sat === "string" && /^[0-9]+$/.test(tx.fee_sat) ? BigInt(tx.fee_sat) : null;
  const stake = tx.stake_sat && /^[0-9]+$/.test(tx.stake_sat) ? BigInt(tx.stake_sat) : 0n;
  const valueTransfer = ["transfer", "transfer_v2", "funded_deposit"].includes(tx.kind);
  const feeChecks = inSum !== null && outSum !== null && fee !== null && inSum - outSum - stake === fee;

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
        amounts and fees come from the verified consensus receipt.
      </p>

      {tx.as_of_slot !== undefined && <p className="lookup-hint">Historical snapshot at slot {fmtInt(tx.as_of_slot)}.</p>}
      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <Kpi k="Outputs" v={outSum === null ? "unreadable" : fmtCompactBloch(outSum)} unit={outSum === null ? undefined : "BLOCH"} tone={outSum === null ? "absent" : "accent"} sub={outSum === null ? "an amount this page could not parse exactly" : `${fmtBloch(outSum, 8)} BLOCH · ${fmtInt(outSum)} sat across ${fmtInt(tx.outputs.length)} outputs`} />
        <Kpi k="Fee" v={fee === null ? "—" : fmtInt(fee)} unit={fee === null ? undefined : "sat"} sub={!valueTransfer ? "fee from the consensus receipt" : feeChecks ? stake > 0n ? "inputs − change − validator stake" : "inputs − outputs, exactly" : "receipt conservation mismatch"} />
        <Kpi k="Inputs → outputs" v={`${fmtInt(tx.inputs.length)} → ${fmtInt(tx.outputs.length)}`} sub={inSum === null ? undefined : `${fmtBloch(inSum, 4)} BLOCH spent in`} />
        <Kpi k="Size" v={fmtInt(tx.size_bytes)} unit="B" sub="encoded bytes — a Falcon signature is variable length" />
        <Kpi k="Block" v={<Link to={`/block/${tx.block_id}`} className="mono-link">{short(tx.block_id, 10, 6)}</Link>} sub={`slot ${fmtInt(tx.slot)} · height ${fmtInt(tx.height)}`} />
        {stake > 0n && <Kpi k="Validator stake" v={fmtBloch(stake, 8)} unit="BLOCH" sub="locked by this registration; excluded from the fee" />}
        <Kpi k="Receipt" v="verified" sub="consensus replay and block state-root verification" />
      </div>

      <div className="tx-io">
        <section className="card" style={{ margin: 0 }}>
          <h2 className="snap-h2">Inputs — {fmtInt(tx.inputs.length)}</h2>
          {tx.inputs.length === 0 ? (
            <p className="lookup-hint">This transaction spends no eUTXO inputs. Any withdrawal proceeds are shown under outputs.</p>
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
        <h2 className="snap-h2">Receipt provenance</h2>
        <p className="snap-body">
          The indexer replays canonical blocks from Genesis-4, verifies signatures and
          checks each resulting state root against its block header. Amounts are kept
          as exact integer satoshis. An output can be a payment, change or withdrawal;
          the explorer reports its recorded value without inferring intent.
        </p>
        <p className="snap-body" style={{ marginBottom: 0 }}>
          Finality is reported separately in the live status above. These receipts describe
          the indexed canonical block at the time of the query.
        </p>
      </section>
    </div>
  );
}

export function TxAnswerPage({ hash }: { hash?: string }) {
  const [matches, setMatches] = useState<IndexedTx[]>([]);
  const [tx, setTx] = useState<IndexedTx | null | undefined>(hash ? undefined : null);
  useEffect(() => {
    let stop = false;
    setTx(hash ? undefined : null);
    setMatches([]);
    if (hash) {
      indexerHealth()
        .then((health) => health ? indexedTransaction(hash.toLowerCase()) : null)
        .then((value) => { if (!stop) setTx(value); })
        .catch(e => { if (!stop) { setTx(null); if (e instanceof IndexedTxAmbiguity) setMatches(e.matches); } });
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
      {matches.length > 0 && <section className="card"><h2 className="snap-h2">Choose a transaction occurrence</h2><p>This ID occurs in more than one position. Select its indexed block.</p>{matches.map(t => <p key={`${t.block_id}:${t.index}`}><button className="btn" onClick={() => setTx(t)}>Slot {fmtInt(t.slot)} · transaction {t.index + 1} · {short(t.block_id, 10, 6)}</button></p>)}</section>}
      {!tx && matches.length === 0 && <section className="card">
        <h2 className="snap-h2">Transaction details</h2>
        <p>{tx === undefined ? "Checking the historical index for inputs, outputs and fees…" : "Inputs, outputs, fees and the containing block are not available from the historical index for this ID right now."}</p>
        <p className="lookup-hint">The status above is queried separately and remains available when the index is offline or does not contain this transaction.</p>
        <details><summary>Check a known output</summary><OutpointCheck seedTxid={hash} /></details>
      </section>}
    </div>
    {tx && <TxDetail tx={tx} />}
  </>;
}
