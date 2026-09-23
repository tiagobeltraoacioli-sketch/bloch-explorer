// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { useLiveRead } from "../lib/liveRead";
import { ApiReading, MempoolInfo, mempoolMetrics, decimal, PoolSample, appendSample } from "../lib/observatory";
import { fmtBytes, fmtInt, fmtNum } from "../lib/format";
import { Link } from "../lib/router";
import { ReadToolbar, RawData, TxStatusLookup } from "../components/telemetry";

interface FleetMempoolReading {
  data: {
    state: string;
    sampled_at: number;
    bloch: {
      mempool_sampled_nodes: number | null;
      mempool_min_transactions: number | null;
      mempool_max_transactions: number | null;
    };
  } | null;
}

function measured(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? fmtInt(Math.round(value)) : "—";
}

export function MempoolPage() {
  const live = useLiveRead<ApiReading<MempoolInfo>>("/api/v1/mempool");
  const fleet = useLiveRead<FleetMempoolReading>("/api/v1/observability", 60_000);
  const [history, setHistory] = useState<PoolSample[]>([]);
  const reading = live.data;
  const pool = reading?.data;
  const metrics = mempoolMetrics(pool);
  const source = reading?.corroboration?.source_node ?? null;
  const stale = !!live.error || reading?.cache.state === "stale" || !!reading?.error;
  const fleetPool = fleet.data?.data?.bloch;
  const fleetMin = fleetPool?.mempool_min_transactions;
  const fleetMax = fleetPool?.mempool_max_transactions;
  const fleetSpread = typeof fleetMin === "number" && typeof fleetMax === "number" && fleetMax >= fleetMin ? fleetMax - fleetMin : null;
  useEffect(() => {
    if (!reading || stale || !live.updatedAt || !source) return;
    const size = mempoolMetrics(reading.data).size;
    if (size === null) return;
    const at = live.updatedAt - (reading.cache.age_ms ?? 0);
    setHistory(prev => appendSample(prev, { at, size, bytes: mempoolMetrics(reading.data).bytes, source, salt: reading.chain?.cache_salt ?? null }));
  }, [reading, live.updatedAt, stale, source]);
  const max = Math.max(1, ...history.map(p => p.size));
  const counters = [
    ["Currently barred", pool?.barred, "Transactions in this node’s rejection cache"],
    ["Rejected re-offers", pool?.barred_hits, "Repeat submissions refused since node startup"],
    ["Expired", pool?.expired, "Pending entries removed after their lifetime elapsed"],
    ["Fee evictions", pool?.evicted_low_fee, "Lower-fee entries replaced when the pool was full"],
  ] as const;
  return <div className="container telemetry-page">
    <div className="overview-heading"><div><span className="eyebrow">TRANSACTIONS / MEMPOOL</span><h1>The observer’s transaction pool.</h1></div><ReadToolbar {...live} onRefresh={live.refresh} onPause={() => live.setPaused(!live.paused)} /></div>
    <div className="source-line"><span className="pill warn">Node-local</span><span>{source ?? "Observer not identified"}</span><span>{live.paused ? "Live updates paused" : "Refreshes every 15 seconds"}</span><Link to="/network">RPC health ↗</Link></div>
    {live.error && <div className="errbox" role="alert">{live.error}</div>}
    {stale && pool && <p className="data-warning" role="status">These are previous readings. They do not describe the current mempool.</p>}
    {!pool && !live.error && <p className="data-warning">{live.loading ? "Reading the observer’s mempool…" : "The observer did not provide mempool data."}</p>}
    <p className="data-warning" role="status">This counter is the node’s local pool size, not a count of transactions still awaiting inclusion. A node may retain or receive a copy after a transaction is included. Check the transaction ID below to see its reported chain status.</p>
    <TxStatusLookup />
    <div className="mempool-layout">
      <section className="card pool-capacity">
        <span className="eyebrow">ENTRIES REPORTED BY THIS NODE</span>
        <div className="pool-number">{metrics.size === null ? "—" : fmtInt(metrics.size)}</div>
        <div className="capacity-grid" role="img" aria-label={metrics.occupancy === null ? "Capacity unavailable" : `${fmtNum(metrics.occupancy, 2)} percent of transaction-count capacity used`}>
          {Array.from({ length: 80 }, (_, i) => <i key={i} className={metrics.occupancy !== null && i < Math.ceil(Math.min(100, metrics.occupancy) / 100 * 80) ? "filled" : ""} />)}
        </div>
        <div className="capacity-label"><b>{metrics.occupancy === null ? "—" : `${fmtNum(metrics.occupancy, 2)}%`} used</b><span>{metrics.max === null ? "Capacity not reported" : `${fmtInt(metrics.max)} transaction capacity`}</span></div>
        <p className="lookup-hint">Each cell represents 1.25% of capacity by transaction count. Nodes can hold different entries, including residual copies of transactions already included.</p>
      </section>
      <div className="pool-readouts">
        <section className="card metric-panel"><span className="eyebrow">PAYLOAD IN MEMPOOL</span><strong>{metrics.bytes === null ? "—" : fmtBytes(metrics.bytes)}</strong><span>{metrics.averageBytes === null ? "Average size unavailable for an empty or unread pool" : `${fmtBytes(metrics.averageBytes)} average per transaction`}</span></section>
        <section className="card metric-panel"><span className="eyebrow">NEXT BASE FEE</span><strong>{metrics.nextFee ?? "—"}<small> msat/gas</small></strong><span>The base fee alone does not set inclusion priority.</span><Link to="/fees">Calculate a transfer fee ↗</Link></section>
      </div>
    </div>
    <section className="card">
      <div className="section-heading"><div><h2>Mempool over time</h2><p>Observed in this session · up to 120 readings</p></div><span className="pill quiet">{history.length} samples</span></div>
      {history.length < 2 ? <div className="telemetry-empty">{metrics.size === 0 ? "This observer’s mempool is empty. " : ""}The chart starts after two fresh readings from the same observer.</div> : <>
        <div className="pool-history" role="img" aria-label={`Reported entries range from ${Math.min(...history.map(p => p.size))} to ${Math.max(...history.map(p => p.size))} across ${history.length} session readings.`}>{history.map(p => <div key={p.at} title={`${new Date(p.at).toLocaleTimeString()}: ${p.size} entries`}><i style={{ height: `${p.size / max * 100}%` }} /></div>)}</div>
        <div className="chart-axis"><span>{new Date(history[0].at).toLocaleTimeString()}</span><span>Peak {fmtInt(max === 1 && history.every(p => p.size === 0) ? 0 : max)} txs</span><span>{new Date(history[history.length - 1].at).toLocaleTimeString()}</span></div>
        <details className="raw-reading"><summary>View exact samples</summary><div className="table-wrap"><table className="tbl"><thead><tr><th>Observed at</th><th>Entries</th><th>Bytes</th><th>Observer</th></tr></thead><tbody>{[...history].reverse().map(p => <tr key={p.at}><td>{new Date(p.at).toLocaleTimeString()}</td><td>{fmtInt(p.size)}</td><td>{p.bytes === null ? "—" : fmtInt(p.bytes)}</td><td>{p.source}</td></tr>)}</tbody></table></div></details>
      </>}
      <p className="lookup-hint">A new observer, a reorg or a gap over one minute starts a new series. A falling count can reflect inclusion, expiration or eviction.</p>
    </section>
    <section className="card pool-fleet" aria-labelledby="pool-fleet-heading">
      <div className="section-heading"><div><span className="eyebrow">GRAFANA CLOUD / MULTIPLE OBSERVERS</span><h2 id="pool-fleet-heading">Mempool variation across nodes</h2><p>The latest Prometheus samples from Bloch nodes with an active head.</p></div><Link to="/observability">Inspect telemetry ↗</Link></div>
      <div className="pool-fleet-grid">
        <div><span>Nodes sampled</span><strong>{measured(fleetPool?.mempool_sampled_nodes)}</strong></div>
        <div><span>Smallest local pool</span><strong>{measured(fleetMin)}</strong><small>transactions</small></div>
        <div><span>Largest local pool</span><strong>{measured(fleetMax)}</strong><small>transactions</small></div>
        <div><span>Range</span><strong>{measured(fleetSpread)}</strong><small>transactions apart</small></div>
      </div>
      <p className="lookup-hint">Each node holds its own pending set. These aggregates do not reveal which transaction reached which node, its arrival order or a guaranteed inclusion time. {fleet.data?.data?.sampled_at ? `Read ${new Date(fleet.data.data.sampled_at).toLocaleTimeString()}.` : "Waiting for telemetry."}</p>
    </section>
    <div className="telemetry-metrics">{counters.map(([label, value, note]) => <section key={label} className="card metric-panel"><span className="eyebrow">{label}</span><strong>{decimal(value) ?? "—"}</strong><span>{decimal(value) === null ? "Not reported by this node version" : note}</span></section>)}</div>
    <section className="card coverage-note"><h2>What this view can tell you</h2><p>Local entry count, bytes, next base fee and any rejection counters the observer provides. Per-transaction fees, queue ordering and inclusion estimates require additional node data; the current RPC does not expose them.</p><Link to="/transactions">Explore indexed transactions ↗</Link><RawData data={reading} label="Inspect mempool response and provenance" /></section>
  </div>;
}
