// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "../lib/router";
import { fmtBloch, fmtInt, short } from "../lib/format";
import { IndexedTx, IndexedTxIo, receiptConservation, sumSide } from "../lib/indexer";
import "../tx-flow.css";

const integer = (value: unknown): value is string => typeof value === "string" && /^[0-9]+$/.test(value);

function share(value: string, total: bigint | null): string | undefined {
  if (!integer(value) || total === null || total === 0n) return undefined;
  const basisPoints = BigInt(value) * 10000n / total;
  return `${Number(basisPoints > 10000n ? 10000n : basisPoints) / 100}%`;
}

function FlowSide({ tx, side, entries, total }: { tx: IndexedTx; side: "input" | "output"; entries: IndexedTxIo[]; total: bigint | null }) {
  const isInput = side === "input";
  return <div className="tx-flow-side">
    <div className="tx-flow-side-head">
      <h3>{isInput ? "Consumed inputs" : "Created outputs"}</h3>
      <span>{total === null ? "Amount unavailable" : `${fmtBloch(total, 8)} BLOCH`}</span>
    </div>
    {entries.length === 0 ? <p className="tx-flow-empty">{isInput ? "No eUTXO inputs are recorded for this transaction." : "No eUTXO outputs are recorded for this transaction."}</p> :
      <ol className="tx-flow-list" aria-label={`${isInput ? "Consumed inputs" : "Created outputs"} and their amounts`}>
        {entries.map((entry, index) => {
          const width = share(entry.value_sat, total);
          const outpoint = isInput ? entry.txid && /^[0-9a-f]{64}$/i.test(entry.txid) ? `${entry.txid}:${entry.vout}` : null : `${tx.txid}:${entry.vout}`;
          return <li className="tx-flow-item" key={`${entry.txid ?? tx.txid}:${entry.vout}:${index}`}>
            <div className="tx-flow-item-top">
              <span className="tx-flow-index">{isInput ? `Input ${index + 1}` : `Output ${entry.vout}`}</span>
              <strong>{integer(entry.value_sat) ? `${fmtBloch(entry.value_sat, 8)} BLOCH` : "Amount unavailable"}</strong>
            </div>
            <div className="tx-flow-track" aria-hidden="true">{width !== undefined && <span style={{ width }} />}</div>
            <div className="tx-flow-item-links">
              {outpoint ? <Link to={`/outpoint/${outpoint}`} className="mono-link" title={outpoint}>{isInput ? `Spent ${short(entry.txid!, 8, 6)}:${entry.vout}` : `Inspect output ${entry.vout}`}</Link> : <span>Source outpoint unavailable</span>}
              <Link to={`/hash/${entry.script_hash}`} className="mono-link" title={entry.script_hash}>Script {short(entry.script_hash, 8, 6)}</Link>
            </div>
          </li>;
        })}
      </ol>}
  </div>;
}

/** Receipt-level value flow; no individual input is assigned to a particular output. */
export function TxFlow({ tx }: { tx: IndexedTx }) {
  const inputTotal = sumSide(tx.inputs);
  const outputTotal = sumSide(tx.outputs);
  const transfer = ["transfer", "transfer_v2", "funded_deposit"].includes(tx.kind);
  const conservation = receiptConservation(tx);
  const fee = integer(tx.fee_sat) ? tx.fee_sat : null;
  const stake = integer(tx.stake_sat) ? tx.stake_sat : null;
  return <section className="card tx-flow" aria-labelledby="tx-flow-title">
    <div className="tx-flow-heading">
      <div>
        <h2 id="tx-flow-title" className="snap-h2">eUTXO value flow</h2>
        <p className="tx-flow-caption">Recorded inputs and outputs for this transaction. Each bar shows its share of that side's known total.</p>
      </div>
      <span className={`tx-flow-check ${transfer && conservation === "balanced" ? "is-balanced" : ""}`}>
        {transfer ? conservation === "balanced" ? "Value balanced" : conservation === "mismatch" ? "Value mismatch" : "Balance unavailable" : "Receipt values"}
      </span>
    </div>
    <div className="tx-flow-grid">
      <FlowSide tx={tx} side="input" entries={tx.inputs} total={inputTotal} />
      <div className="tx-flow-center" aria-label="Transaction and receipt allocations">
        <div className="tx-flow-center-arrow" aria-hidden="true">→</div>
        <span className="tx-flow-center-kicker">Transaction</span>
        <strong title={tx.txid}>{short(tx.txid, 10, 8)}</strong>
        <span className="tx-flow-kind">{tx.kind}</span>
        <div className="tx-flow-receipt">
          <span>Fee <strong>{fee === null ? "unavailable" : `${fmtBloch(fee, 8)} BLOCH`}</strong></span>
          {stake !== null && BigInt(stake) > 0n && <span>Validator stake <strong>{fmtBloch(stake, 8)} BLOCH</strong></span>}
        </div>
        <div className="tx-flow-center-arrow" aria-hidden="true">→</div>
      </div>
      <FlowSide tx={tx} side="output" entries={tx.outputs} total={outputTotal} />
    </div>
    <p className="tx-flow-footnote">The receipt records totals and owners; it does not map individual inputs to individual outputs or identify payment versus change. {transfer && conservation === "balanced" && inputTotal !== null && outputTotal !== null && fee !== null ? `Exact balance: ${fmtBloch(inputTotal, 8)} input = ${fmtBloch(outputTotal, 8)} output + ${fmtBloch(stake ?? "0", 8)} stake + ${fmtBloch(fee, 8)} fee BLOCH.` : `Input ${inputTotal === null ? "unavailable" : fmtInt(inputTotal)} sat · output ${outputTotal === null ? "unavailable" : fmtInt(outputTotal)} sat.`}</p>
  </section>;
}
