// SPDX-License-Identifier: AGPL-3.0-or-later
import { G4Head } from "../lib/g4";
import { SlotCell, windowStats } from "../lib/slots";
import { fmtBytes, fmtInt, fmtNum, timeAgo } from "../lib/format";
import { Link } from "../lib/router";

interface PoolReading { size: number; max: number; bytes: number }

/** Every tile is an observed slot. Pending transactions are never projected
 * into fictional blocks: neither transaction gas nor ordering is available. */
export function ChainOverview({ head, cells, mempool, stale }: {
  head: G4Head; cells: SlotCell[]; mempool: PoolReading | null; stale: boolean;
}) {
  const stats = windowStats(cells);
  const recent = cells.slice(-7).reverse();
  const maxTxs = Math.max(1, ...cells.map(c => c.kind === "block" ? c.block.tx_count : 0));
  const active = head.validators?.active ?? 0;
  const seats = active > 0 ? Math.max(1, Math.floor(active / head.slots_per_epoch)) : null;
  const attestationPct = seats && stats.meanAttestations !== null
    ? Math.min(100, stats.meanAttestations / seats * 100)
    : null;
  const finalityGap = Math.max(0, head.epoch - head.finalized.epoch);
  const mempoolPct = mempool && mempool.max > 0 ? Math.min(100, mempool.size / mempool.max * 100) : null;
  return <section className="chain-overview" aria-label="Chain activity overview">
    <div className="overview-heading">
      <div><span className="eyebrow">GENESIS 4 / EXPLORER</span><h1>The chain, at a glance.</h1></div>
      <div className="overview-tools"><span className={"pill " + (stale ? "warn" : "quiet")}>{stale ? "Last available reading" : "Auto-refresh · 15s"}</span><Link to="/network" className="pill-tab">Network & RPCs ↗</Link></div>
    </div>
    <div className="network-tape" role="list" aria-label="Live chain tape">
      <Link to={`/slot/${head.slot}`} role="listitem"><span>Head slot</span><strong>{fmtInt(head.slot)}</strong></Link>
      <Link to="/blocks" role="listitem"><span>Canonical height</span><strong>{fmtInt(head.height)}</strong></Link>
      <Link to={`/epoch/${head.epoch}`} role="listitem"><span>Epoch</span><strong>{fmtInt(head.epoch)} <small>{head.slot_in_epoch + 1}/{head.slots_per_epoch}</small></strong></Link>
      <Link to="/finality" role="listitem"><span>Finalized</span><strong>E{fmtInt(head.finalized.epoch)} <small>−{fmtInt(finalityGap)}</small></strong></Link>
      <Link to="/validators" role="listitem"><span>Active validators</span><strong>{head.validators ? fmtInt(head.validators.active) : "—"}</strong></Link>
      <Link to="/fees" role="listitem"><span>Next base fee</span><strong>{head.next_base_fee_millisat_per_gas ?? "—"} <small>msat/gas</small></strong></Link>
    </div>
    <div className="block-ribbon" tabIndex={0} role="region" aria-label="Recent slots, newest first; scroll for earlier slots">
      <Link to="/mempool" className="ribbon-pending">
        <span className="eyebrow">MEMPOOL AT ONE NODE</span>
        <strong>{mempool ? fmtInt(mempool.size) : "—"}<small> local entries</small></strong>
        <span>{mempool ? `${fmtBytes(mempool.bytes)} · capacity ${fmtInt(mempool.max)}` : "Mempool not reported"}</span>
        <span className="ribbon-meter" aria-hidden="true"><i style={{ width: `${mempoolPct ?? 0}%` }} /></span>
        <span className="ribbon-bottom">Check inclusion status ↗</span>
      </Link>
      <div className="ribbon-divider" aria-hidden="true" />
      {recent.length === 0 ? <div className="ribbon-empty">Loading the latest slots…</div> : recent.map(c => {
        const b = c.kind === "block" ? c.block : null;
        const state = b ? b.finality : c.kind;
        return <Link key={c.slot} to={`/slot/${c.slot}`} className={`ribbon-block is-${state}`}
          title={b ? `Slot ${c.slot}, height ${b.height ?? "not canonical"}, proposer ${b.proposer_index}, ${b.tx_count} transactions; reported ${b.finality}` : `Slot ${c.slot}: ${c.kind === "empty" ? "no block" : "not read"}`}>
          <span className="ribbon-slot">{fmtInt(c.slot)}</span>
          <strong>{b ? fmtInt(b.tx_count) : "—"}</strong>
          <span>{b ? "transactions" : c.kind === "empty" ? "missed slot" : "unread slot"}</span>
          {b && <span className="ribbon-meta">height {b.height === null ? "—" : fmtInt(b.height)} · proposer v{b.proposer_index}</span>}
          {b && <span className="ribbon-meter att" title={`${fmtInt(b.attestation_count)} attestations`} aria-hidden="true"><i style={{ width: `${seats ? Math.min(100, b.attestation_count / seats * 100) : 0}%` }} /></span>}
          <span className="ribbon-bottom">{b ? timeAgo(b.timestamp) : "No block data"}</span>
          <span className="ribbon-state">{b ? b.finality.replace(/_/g, " ") : c.kind === "empty" ? "missed" : "unknown"}</span>
        </Link>;
      })}
    </div>
    <div className="overview-panels">
      <Link to="/fees" className="overview-instrument">
        <span className="eyebrow">NEXT BLOCK BASE FEE</span>
        <strong>{head.next_base_fee_millisat_per_gas ?? "—"}<small> msat/gas</small></strong>
        <span>Current base fee {head.base_fee_millisat_per_gas ?? "—"} · fee calculator ↗</span>
      </Link>
      <Link to="/analytics" className="overview-instrument activity-instrument">
        <span className="eyebrow">TRANSACTION ACTIVITY</span>
        <strong>{cells.length ? fmtInt(stats.txs) : "—"}<small> in {cells.length} observed slots</small></strong>
        <div className="activity-columns" role="img" aria-label={`${stats.txs} transactions across ${cells.length} observed slots; ${stats.unknown} unread`}>
          {cells.map(c => <i key={c.slot} className={`activity-${c.kind}`} title={`Slot ${c.slot}: ${c.kind === "block" ? c.block.tx_count + " transactions" : c.kind}`} style={{ height: c.kind === "block" ? `${Math.max(8, c.block.tx_count / maxTxs * 100)}%` : "8%" }} />)}
        </div>
      </Link>
      <Link to="/blocks" className="overview-instrument">
        <span className="eyebrow">BLOCK PRODUCTION</span>
        <strong>{stats.fillRate === null ? "—" : fmtNum(stats.fillRate * 100, 1) + "%"}<small> of readable slots</small></strong>
        <span>{stats.blocks} blocks · {stats.empty} missed · {stats.unknown} unread</span>
      </Link>
      <Link to="/finality" className="overview-instrument finality-instrument">
        <span className="eyebrow">FINALITY DISTANCE</span>
        <strong>{fmtInt(finalityGap)}<small> epochs behind head</small></strong>
        <span>Justified E{fmtInt(head.justified.epoch)} · finalized E{fmtInt(head.finalized.epoch)} ↗</span>
      </Link>
      <Link to="/validators" className="overview-instrument attestation-instrument">
        <span className="eyebrow">ATTESTATION SUPPORT</span>
        <strong>{attestationPct === null ? "—" : `${fmtNum(attestationPct, 1)}%`}<small> mean observed</small></strong>
        <span>{stats.meanAttestations === null ? "No produced blocks read" : `${fmtNum(stats.meanAttestations, 2)} attestations per block · ${seats ?? "—"} is full`}</span>
      </Link>
    </div>
  </section>;
}
