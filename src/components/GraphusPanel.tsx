// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { indexedTransactions } from "../lib/indexer";
import { graphusPage, type GraphusTransaction } from "../lib/graphus";
import { pollWhileVisible } from "../lib/polling";
import { fmtInt } from "../lib/format";

/** Bloch-only entry point backed by the explorer's public historical API. */
export function GraphusPanel() {
  const [record, setRecord] = useState<GraphusTransaction | null>(null);
  const [asOfSlot, setAsOfSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const stop = pollWhileVisible(async () => {
      try {
        const page = graphusPage(await indexedTransactions(undefined, 1));
        if (!page) throw new Error("Invalid indexer response");
        if (active) { setRecord(page.transactions[0] ?? null); setAsOfSlot(page.asOfSlot); setError(null); }
      } catch {
        if (active) setError("The historical index is unavailable. Retry when it answers.");
      }
    }, 60_000);
    return () => { active = false; stop(); };
  }, []);
  return <section className="card graphus-panel" aria-labelledby="graphus-panel-title">
    <div className="graphus-copy">
      <span className="eyebrow">BLOCH GRAPHUS / CHAIN FACTS</span>
      <h2 id="graphus-panel-title">Follow transactions and wallet balances.</h2>
      <p>Inspect Bloch eUTXO inputs, created outputs and a holder heat map whose points scale with indexed script balances, here in the explorer.</p>
      <div className="graphus-facts" aria-label="Graphus Bloch data boundaries">
        <span>BLCH only</span><span>Indexed balances</span><span>No ownership inference</span>
      </div>
      <div className="graphus-actions">
        <Link className="btn" to="/graphus/constellation">Open Bloch constellation →</Link>
        {record && <Link to={`/tx/${record.txid}`}>Inspect transaction receipt ↗</Link>}
      </div>
      <small>{error ?? (record ? `Latest indexed transaction ${record.txid.slice(0, 12)}… · slot ${fmtInt(record.slot)} · snapshot ${fmtInt(asOfSlot ?? 0)}.` : "Waiting for an indexed Bloch transaction.")} The diagram shows record types; an input outpoint alone does not identify a sender or owner.</small>
    </div>
    <div className="graphus-visual" role="img" aria-label={record ? `Bloch transaction at slot ${record.slot}, with ${record.inputs.length} input records and ${record.outputs.length} output records. Diagram shows record relationships, not wallet ownership.` : "Bloch transaction record diagram awaiting indexer data."}>
      <div className="graphus-visual-head"><span>GRAPHUS / BLCH</span><span>{record ? `SLOT ${fmtInt(record.slot)}` : "AWAITING INDEXER"}</span></div>
      <svg viewBox="0 0 520 300" aria-hidden="true" focusable="false">
        <g className="graphus-edges"><path d="M256 146L103 77M256 146L411 70M256 146L118 236M256 146L396 232" /></g>
        <g className="graphus-node graphus-node-muted"><circle cx="103" cy="77" r="9" /><text x="103" y="48" textAnchor="middle">{record ? `${record.inputs.length} INPUTS` : "INPUTS"}</text></g>
        <g className="graphus-node graphus-node-muted"><circle cx="411" cy="70" r="9" /><text x="411" y="42" textAnchor="middle">{record ? `${record.outputs.length} OUTPUTS` : "OUTPUTS"}</text></g>
        <g className="graphus-node graphus-node-muted"><circle cx="118" cy="236" r="9" /><text x="118" y="270" textAnchor="middle">BLOCK</text></g>
        <g className="graphus-node graphus-node-muted"><circle cx="396" cy="232" r="9" /><text x="396" y="266" textAnchor="middle">SNAPSHOT</text></g>
        <g className="graphus-node graphus-node-core"><circle cx="256" cy="146" r="30" /><text x="256" y="151" textAnchor="middle">B</text><text x="256" y="200" textAnchor="middle">TRANSACTION</text></g>
      </svg>
      <div className="graphus-visual-foot"><span>{record ? `${record.txid.slice(0, 16)}…` : "Waiting for chain records"}</span><span>{asOfSlot !== null ? `AS OF S${fmtInt(asOfSlot)}` : "—"}</span></div>
    </div>
  </section>;
}
