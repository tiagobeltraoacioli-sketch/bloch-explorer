// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { indexedHolders } from "../lib/indexer";
import { graphusHeat, graphusHoldersPage, type GraphusHoldersPage } from "../lib/graphus";
import { pollWhileVisible } from "../lib/polling";
import { fmtBloch, fmtInt } from "../lib/format";
import "../oculum.css";

export function HolderOculum({ compact = false }: { compact?: boolean }) {
  const [page, setPage] = useState<GraphusHoldersPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const stop = pollWhileVisible(async () => {
      try {
        const result = graphusHoldersPage(await indexedHolders(compact ? 16 : 64));
        if (!result) throw new Error("The indexer returned an invalid holder snapshot.");
        if (active) { setPage(result); setError(null); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Holder balances are unavailable.");
      }
    }, 60_000);
    return () => { active = false; stop(); };
  }, [compact]);
  const largest = page?.holders[0]?.balanceSat ?? "0";
  const shown = page?.holders.reduce((sum, holder) => sum + BigInt(holder.balanceSat), 0n) ?? 0n;
  const indexedTotal = BigInt(page?.indexedTotalSat ?? "0");
  const share = indexedTotal > 0n ? Number(shown * 10_000n / indexedTotal) / 100 : null;
  return <section id={compact ? "oculum-preview" : "oculum-map"} className={`card oculum-panel${compact ? " oculum-compact" : ""}`} aria-labelledby={compact ? "oculum-preview-title" : "oculum-map-title"}>
    <div className="oculum-heading">
      <div><span className="eyebrow">GRAPHUS OCULUM / BLOCH GENESIS-4</span><h2 id={compact ? "oculum-preview-title" : "oculum-map-title"}>The holder heat map.</h2><p>Largest indexed eUTXO balances, one script reference per point. Size and glow rise with the amount held.</p></div>
      <div className="oculum-snapshot" aria-live="polite"><strong>{page ? `H${fmtInt(page.height)} · S${fmtInt(page.slot)}` : "Waiting for indexer"}</strong><span>{page ? `${fmtInt(page.returned)} shown / ${fmtInt(page.total)} funded references` : "Canonical index snapshot"}</span></div>
    </div>
    {error && <p className="data-warning" role="status">{error}{page ? " Showing the last available snapshot." : ""}</p>}
    <div className="oculum-grid" role="list" aria-label="Largest Bloch script balances; click a point to explore its ledger reference">
      {page?.holders.map(holder => {
        const heat = graphusHeat(holder.balanceSat, largest);
        const tier = Math.max(1, Math.min(4, Math.ceil(heat.intensity * 4)));
        return <div className="oculum-cell" role="listitem" key={holder.scriptHash}>
          <a className={`oculum-point oculum-tier-${tier}`} href={`/graphus/constellation?script=${holder.scriptHash}`} aria-label={`Rank ${holder.rank}, ${fmtBloch(holder.balanceSat, 8)} BLOCH, ${holder.utxoCount} UTXOs. Explore in Graphus.`} title={`#${holder.rank} · ${fmtBloch(holder.balanceSat, 8)} BLOCH · ${fmtInt(holder.utxoCount)} UTXOs`}>
            <span className="oculum-orb" style={{ width: heat.radius * 2, height: heat.radius * 2 }}><span>{holder.rank}</span></span>
          </a>
        </div>;
      })}
      {!page && <p className="oculum-loading">{error ?? "Loading indexed holder balances…"}</p>}
    </div>
    {page && <div className="oculum-summary"><div><span>Largest reference</span><strong>{fmtBloch(largest, 2)} BLCH</strong></div><div><span>Shown share of indexed eUTXOs</span><strong>{share === null ? "—" : `${share.toFixed(2)}%`}</strong></div><div><span>Coverage</span><strong>{page.returned === page.total ? `All ${fmtInt(page.total)} funded references` : `Top ${fmtInt(page.returned)} of ${fmtInt(page.total)}`}</strong></div></div>}
    <div className="oculum-foot"><span>Heat scale: relative to the largest displayed balance</span><i aria-hidden="true" /><span>More BLCH → brighter</span></div>
    <p className="oculum-boundary">Balances are exact indexed satoshis; point sizes use a logarithmic visual scale. A script reference does not identify a person or prove common wallet ownership. This ranking covers unspent eUTXOs only; staked or delegated amounts are outside it.</p>
    {compact && <a className="btn btn-sm" href="/graphus/constellation#oculum-map">Explore the full holder map →</a>}
  </section>;
}
