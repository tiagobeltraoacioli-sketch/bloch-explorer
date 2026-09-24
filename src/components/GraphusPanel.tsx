// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "../lib/router";

const GRAPHUS_BLOCH_PREVIEW = "https://bloch-graphus.xyz/constellation?wallet=SIM-BLCH-001";

/** Product preview only. The Graphus public constellation uses synthetic wallets. */
export function GraphusPanel() {
  return <section className="card graphus-panel" aria-labelledby="graphus-panel-title">
    <div className="graphus-copy">
      <span className="eyebrow">BLOCH GRAPHUS / BLOCH INC.</span>
      <h2 id="graphus-panel-title">From a Bloch eUTXO to its evidence.</h2>
      <p>Graphus explores how Bloch wallet and transaction relationships can carry source references, event time and finality context. Its public BLCH constellation is a synthetic product preview.</p>
      <div className="graphus-facts" aria-label="Graphus Bloch preview boundaries">
        <span>BLCH only</span><span>Synthetic wallets</span><span>No AML score</span>
      </div>
      <div className="graphus-actions">
        <a className="btn" href={GRAPHUS_BLOCH_PREVIEW} rel="noopener noreferrer">Explore the Bloch constellation ↗</a>
        <Link to="/transactions">Inspect live chain transactions →</Link>
      </div>
      <small>The diagram is illustrative. Input references do not identify a sender or owner; Graphus research is separate from Bloch consensus and this explorer's live chain readings.</small>
    </div>
    <div className="graphus-visual" role="img" aria-label="Illustrative Bloch evidence graph linking a wallet reference to transaction, eUTXO, source and finality records. Synthetic preview, not live chain data.">
      <div className="graphus-visual-head"><span>GRAPHUS / BLCH</span><span>SYNTHETIC PREVIEW</span></div>
      <svg viewBox="0 0 520 300" aria-hidden="true" focusable="false">
        <g className="graphus-edges">
          <path d="M256 146L103 77M256 146L411 70M256 146L118 236M256 146L396 232M103 77L118 236M411 70L396 232" />
        </g>
        <g className="graphus-node graphus-node-muted"><circle cx="103" cy="77" r="9" /><text x="103" y="48" textAnchor="middle">SOURCE</text></g>
        <g className="graphus-node graphus-node-muted"><circle cx="411" cy="70" r="9" /><text x="411" y="42" textAnchor="middle">TRANSACTION</text></g>
        <g className="graphus-node graphus-node-muted"><circle cx="118" cy="236" r="9" /><text x="118" y="270" textAnchor="middle">eUTXO</text></g>
        <g className="graphus-node graphus-node-muted"><circle cx="396" cy="232" r="9" /><text x="396" y="266" textAnchor="middle">FINALITY</text></g>
        <g className="graphus-node graphus-node-core"><circle cx="256" cy="146" r="30" /><text x="256" y="151" textAnchor="middle">B</text><text x="256" y="200" textAnchor="middle">BLOCH REFERENCE</text></g>
      </svg>
      <div className="graphus-visual-foot"><span>Evidence links need provenance.</span><span>01 / 01</span></div>
    </div>
  </section>;
}
