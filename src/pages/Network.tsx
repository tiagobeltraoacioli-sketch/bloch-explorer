// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { useLiveRead } from "../lib/liveRead";
import { appendPeerHistory, freshPeerReading, observabilitySummary, peerHistoryCsv, peerRangeHistory, peerRangeQuality, type PeerHistorySample, type PeerRangePeriod, type PeerRangePoint } from "../lib/observabilityCloud";
import { ApiReading, NetworkData, Observer, RpcMethod } from "../lib/observatory";
import { fmtInt } from "../lib/format";
import { ReadToolbar, RawData } from "../components/telemetry";
import { Link } from "../lib/router";

type NetworkTab = "nodes" | "methods" | "api";
type NodeFilter = "all" | "issues" | "responding";

const TABS: { id: NetworkTab; label: string }[] = [
  { id: "nodes", label: "RPC nodes" },
  { id: "methods", label: "Method catalogue" },
  { id: "api", label: "Public API" },
];

function counter(value: number | undefined): string {
  return value === undefined ? "—" : fmtInt(value);
}

function nodeHasIssue(node: Observer, sampledAt: number): boolean {
  return node.status !== "responding" || node.cooling ||
    (node.age_ms !== null && node.age_ms > 60_000) ||
    (node.chain !== null && sampledAt - node.chain.sampled_at > 60_000) ||
    (node.chain?.lag_slots ?? 0) > 0;
}

function requestSuccess(node: Observer): string | null {
  if (node.requests <= 0 || node.failures < 0 || node.failures > node.requests) return null;
  return `${((node.requests - node.failures) / node.requests * 100).toFixed(1)}% successful since this edge isolate started`;
}

function support(method: RpcMethod, nodes: Observer[], now: number): string {
  const samples = nodes.filter(n => n.role === "observer").map(n => n.methods[method.name]).filter(s => s && now - s.sampled_at <= 120_000);
  const yes = samples.filter(s => s.supported === true).length;
  if (method.corroboration === "edge") return "Answered by edge";
  if (yes) return `Observed on ${yes} ${yes === 1 ? "node" : "nodes"}`;
  if (samples.some(s => s.supported === false)) return "Not supported in sampled responses";
  return "Not recently observed";
}

function NetworkConnections() {
  const live = useLiveRead<unknown>("/api/v1/observability", 30_000);
  const [now, setNow] = useState(() => Date.now());
  const [history, setHistory] = useState<PeerHistorySample[]>([]);
  const [chartMode, setChartMode] = useState<PeerRangePeriod | "session">("6h");
  const period: PeerRangePeriod = chartMode === "session" ? "6h" : chartMode;
  const rangeLive = useLiveRead<unknown>(`/api/v1/observability/peer-history?period=${period}`, 300_000);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
  const summary = observabilitySummary(live.data);
  const reading = freshPeerReading(summary, now);
  useEffect(() => {
    if (live.error || !reading || summary?.sampledAt == null ||
        !Number.isSafeInteger(summary.sampledAt) || summary.sampledAt > now + 5_000 ||
        now - summary.sampledAt > 90_000) return;
    setHistory(previous => appendPeerHistory(previous, {
      at: summary.sampledAt as number,
      connections: reading.connections,
      reportingNodes: reading.reportingNodes,
    }));
  }, [live.updatedAt, live.error, summary?.sampledAt, reading?.connections, reading?.reportingNodes]);
  const measured = (value: number | null | undefined) => value == null ? "—" : fmtInt(value);
  const range = peerRangeHistory(rangeLive.data, period);
  const quality = range ? peerRangeQuality(range) : null;
  const trend: PeerRangePoint[] = chartMode !== "session" ? range ?? [] : history.map(sample => ({
    at: sample.at, connections: sample.connections, reportingNodes: sample.reportingNodes,
  }));
  const valid = trend.filter((point): point is PeerRangePoint & { connections: number; reportingNodes: number } =>
    point.connections !== null && point.reportingNodes !== null);
  const first = trend[0], last = trend.at(-1);
  const low = valid.length ? Math.min(...valid.map(sample => sample.connections)) : 0;
  const high = valid.length ? Math.max(...valid.map(sample => sample.connections)) : 0;
  const span = Math.max(1, high - low);
  const duration = first && last ? Math.max(1, last.at - first.at) : 1;
  const x = (sample: PeerRangePoint) => 20 + (sample.at - first.at) / duration * 560;
  const y = (connections: number) => high === low ? 80 : 140 - (connections - low) / span * 120;
  const segments: (PeerRangePoint & { connections: number; reportingNodes: number })[][] = [];
  for (let index = 0; index < trend.length; index++) {
    const point = trend[index];
    if (point.connections === null || point.reportingNodes === null) continue;
    const previous = trend[index - 1];
    if (!previous || previous.connections === null || previous.reportingNodes !== point.reportingNodes) segments.push([]);
    segments.at(-1)!.push(point as PeerRangePoint & { connections: number; reportingNodes: number });
  }
  const sessionChange = history.length > 1 ? history.at(-1)!.connections - history[0].connections : 0;
  const downloadCsv = () => {
    if (!trend.length) return;
    const blob = new Blob([peerHistoryCsv(trend)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bloch-peer-connections-${chartMode}-${new Date(trend.at(-1)!.at).toISOString().slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return <section className="card" aria-labelledby="network-connections-heading">
    <div className="section-heading"><div><span className="eyebrow">PROMETHEUS / GENESIS-4 NODES</span><h2 id="network-connections-heading">Network connections</h2><p>Fresh samples from monitored chain nodes, separate from the explorer’s RPC observer pool.</p></div><Link to="/observability">Inspect telemetry ↗</Link></div>
    <div className="edge-counter-grid" aria-live="polite">
      <div className="card"><span className="eyebrow">REPORTED CONNECTIONS</span><strong>{measured(reading?.connections)}</strong><small>{reading ? `${measured(reading.reportingNodes)} nodes · oldest sample ${new Date(reading.sampledAt).toLocaleTimeString()}` : "Awaiting samples no older than 90 seconds"}</small></div>
      <div className="card"><span className="eyebrow">P2P / DEVNET TRANSPORT</span><strong>{reading?.p2pConnections == null || reading.devnetConnections == null ? "—" : `${measured(reading.p2pConnections)} / ${measured(reading.devnetConnections)}`}</strong><small>Shown when both gauges cover every reporting node</small></div>
      <div className="card"><span className="eyebrow">CONNECTIONS PER NODE</span><strong>{reading?.minPerNode == null || reading.maxPerNode == null ? "—" : `${measured(reading.minPerNode)}–${measured(reading.maxPerNode)}`}</strong><small>Fewest to most · median {reading?.medianPerNode == null ? "—" : reading.medianPerNode.toLocaleString(undefined, { maximumFractionDigits: 1 })}</small></div>
      <div className="card"><span className="eyebrow">ZERO-CONNECTION NODES</span><strong>{measured(reading?.isolatedNodes)}</strong><small>{live.error ?? (reading ? "Monitored nodes with no live peer sockets" : "Awaiting fresh network readings")}</small></div>
    </div>
    <div className="peer-history-heading"><h3>Connection trend</h3><span>{chartMode !== "session" ? `${valid.length} / ${trend.length || (period === "7d" ? 169 : period === "24h" ? 97 : 73)} samples` : `${history.length} session samples · ${sessionChange >= 0 ? "+" : ""}${fmtInt(sessionChange)} since first sample`}</span></div>
    <div className="telemetry-tabs peer-history-tabs" role="group" aria-label="Connection trend period">{(["6h", "24h", "7d", "session"] as const).map(value => <button key={value} type="button" className={chartMode === value ? "active" : ""} aria-pressed={chartMode === value} onClick={() => setChartMode(value)}>{value === "6h" ? "Last 6 hours" : value === "24h" ? "Last 24 hours" : value === "7d" ? "Last 7 days" : "This session"}</button>)}</div>
    {chartMode !== "session" && quality && <div className="peer-quality-grid" aria-label="Historical sample quality">
      <div><span>Available samples</span><strong>{quality.present} / {quality.total}</strong><small>{quality.missing} missing buckets</small></div>
      <div><span>First available</span><strong>{quality.firstAvailableAt === null ? "—" : new Date(quality.firstAvailableAt).toLocaleDateString()}</strong><small>{quality.firstAvailableAt === null ? "No measured point" : new Date(quality.firstAvailableAt).toLocaleTimeString()}</small></div>
      <div><span>Reporting nodes</span><strong>{quality.minReportingNodes === null ? "—" : `${quality.minReportingNodes}–${quality.maxReportingNodes}`}</strong><small>minimum to maximum</small></div>
      <div><span>Coverage changes</span><strong>{quality.coverageChanges}</strong><small>between adjacent measured buckets</small></div>
    </div>}
    <div className="peer-history-tools"><span>{chartMode === "session" ? "Current tab only" : "UTC timestamps in CSV · empty cells mean no sample"}</span><button className="btn btn-sm" type="button" onClick={downloadCsv} disabled={!trend.length}>Download CSV</button></div>
    {chartMode !== "session" && rangeLive.error && range && <p className="data-warning" role="status">History refresh failed. Showing the last successful reading.</p>}
    {valid.length < 2 ? <div className="telemetry-empty">{chartMode !== "session" ? rangeLive.error ?? "Waiting for historical samples from Prometheus." : "The session chart starts after two fresh readings with the same reporter count."}</div> : <>
      <div className="peer-history-chart" role="img" aria-label={`Reported connections ranged from ${low} to ${high} across ${valid.length} measured points. Gaps or changes in reporting-node count interrupt the line.`}>
        <svg viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true"><path d="M20 140H580" className="peer-history-baseline" />{segments.map((segment, index) => segment.length > 1
          ? <polyline key={index} points={segment.map(point => `${x(point)},${y(point.connections)}`).join(" ")} />
          : <circle key={index} cx={x(segment[0])} cy={y(segment[0].connections)} r="3" />)}</svg>
      </div>
      <div className="peer-history-axis"><span>{new Date(first.at).toLocaleTimeString()}</span><span>{fmtInt(low)}–{fmtInt(high)} connections</span><span>{new Date(last?.at ?? first.at).toLocaleTimeString()}</span></div>
      <details className="raw-reading"><summary>View exact samples</summary><div className="table-wrap"><table className="tbl"><thead><tr><th>Sampled at</th><th>Connections</th><th>Reporting nodes</th></tr></thead><tbody>{[...trend].reverse().map(point => <tr key={point.at}><td>{new Date(point.at).toLocaleString()}</td><td>{measured(point.connections)}</td><td>{measured(point.reportingNodes)}</td></tr>)}</tbody></table></div></details>
    </>}
    <p className="lookup-hint">Historical views use fixed Prometheus samples: 5 minutes over 6 hours, 15 minutes over 24 hours, or 1 hour over 7 days. Missing readings and changed reporter coverage break the line. The session view starts when this tab opens and restarts after a 75-second gap or coverage change. All charts scale vertically to their observed range. CSV exports every selected bucket and leaves missing readings blank.</p>
    <p className="lookup-hint">A peer may connect to several monitored nodes, so these are connection reports, not unique network peers. “Devnet” is a transport name, not the chain stage. Prometheus coverage and RPC observer health measure different node sets.</p>
  </section>;
}

export function NetworkPage() {
  const live = useLiveRead<ApiReading<NetworkData>>("/api/v1/network", 30_000);
  const [tab, setTab] = useState<NetworkTab>("nodes");
  const [query, setQuery] = useState("");
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>("all");
  const data = live.data?.data;
  const nodes = data?.nodes ?? [];
  const observers = nodes.filter(n => n.role === "observer").map(n => {
    const cached = data?.build;
    if (n.build || !cached?.data || cached.corroboration.source_node !== n.id) return n;
    return { ...n, build: cached.data, build_sampled_at: (data?.sampled_at ?? Date.now()) - (cached.cache.age_ms ?? 0) };
  });
  const methods = data?.capabilities.methods ?? [];
  const filtered = methods.filter(m => `${m.name} ${m.summary}`.toLowerCase().includes(query.toLowerCase()));
  const recent = observers.filter(n => n.status === "responding" && n.age_ms !== null && n.age_ms <= 60_000);
  const head = data?.head.data;
  const planeFresh = data?.plane.age_ms != null && data.plane.age_ms <= 40_000;
  const counters = data?.counters;
  const cacheReads = (counters?.cacheHits ?? 0) + (counters?.cacheMisses ?? 0);
  const cacheHitRate = cacheReads > 0 ? (counters?.cacheHits ?? 0) / cacheReads * 100 : null;
  const sampledAt = data?.sampled_at ?? Date.now();
  const filteredNodes = nodes.filter((node) => nodeFilter === "all" || (nodeFilter === "issues" ? nodeHasIssue(node, sampledAt) : node.status === "responding"));
  const freshObservers = recent;
  const staleObservers = observers.filter((node) => nodeHasIssue(node, sampledAt));
  const lags = observers.map((node) => node.chain?.lag_slots).filter((lag): lag is number => typeof lag === "number");
  const worstLag = lags.length ? Math.max(...lags) : null;
  const witness = data?.witness;
  return <div className="container telemetry-page">
    <div className="overview-heading"><div><span className="eyebrow">INFRASTRUCTURE / DATA SOURCES</span><h1>Behind every reading.</h1></div><ReadToolbar {...live} onRefresh={live.refresh} onPause={() => live.setPaused(!live.paused)} /></div>
    {live.error && <div className="errbox" role="alert">{live.error} {data ? "The panels retain the previous snapshot." : ""}</div>}
    {data?.head.error && <div className="data-warning" role="status">The chain head could not be refreshed: {data.head.error.message ?? "read unavailable"}. Passive RPC observations remain available.</div>}
    <div className="telemetry-metrics">
      <section className="card metric-panel"><span className="eyebrow">RESPONDING OBSERVERS</span><strong>{data ? `${recent.length} / ${observers.length}` : "—"}</strong><span>From RPC calls sampled in the last minute</span></section>
      <section className="card metric-panel"><span className="eyebrow">HEAD SLOT</span><strong>{head ? fmtInt(head.slot) : "—"}</strong><span>{head ? `Height ${fmtInt(head.height)} · epoch ${fmtInt(head.epoch)}` : "Waiting for a chain reading"}</span></section>
      <section className="card metric-panel"><span className="eyebrow">READ METHODS</span><strong>{data ? methods.length : "—"}</strong><span>{data ? `${methods.filter(m => m.optional).length} optional methods depend on the node version` : "Waiting for the capability catalogue"}</span></section>
      <section className="card metric-panel"><span className="eyebrow">LINEAGE CHECK</span><strong className="metric-word">{!data ? "—" : !planeFresh ? "Outdated" : data.plane.certified ? "Matched" : "Unverified"}</strong><span>{data?.plane.reason ?? "Observer lineage compared with a scheduled witness"}</span></section>
    </div>
    <div className="telemetry-tabs" role="tablist" aria-label="Network views">{TABS.map(({ id, label }, index) => <button key={id} id={`network-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`network-panel-${id}`} tabIndex={tab === id ? 0 : -1} className={tab === id ? "active" : ""} onClick={() => setTab(id)} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const next = (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length; setTab(TABS[next].id); (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus(); }}>{label}</button>)}</div>
    {tab === "nodes" && <div role="tabpanel" id="network-panel-nodes" aria-labelledby="network-tab-nodes">
      <NetworkConnections />
      <div className="edge-counter-grid" aria-label="Current observer diagnostics">
        <section className="card"><span className="eyebrow">FRESH OBSERVERS</span><strong>{data ? `${freshObservers.length} / ${observers.length}` : "—"}</strong><small>{data ? `${staleObservers.length} need attention or a fresh sample` : "No observer snapshot yet"}</small></section>
        <section className="card"><span className="eyebrow">HEAD AGREEMENT</span><strong>{!data || !planeFresh ? "—" : data.plane.agree_on_head === true ? "Agree" : data.plane.agree_on_head === false ? "Differ" : "Unknown"}</strong><small>{data?.plane.responding !== undefined && data?.plane.of !== undefined ? `${data.plane.responding} of ${data.plane.of} observers represented` : "Requires a current lineage sample"}</small></section>
        <section className="card"><span className="eyebrow">WORST OBSERVED LAG</span><strong>{worstLag === null ? "—" : fmtInt(worstLag)}</strong><small>{worstLag === null ? "No comparable head samples" : `slot${worstLag === 1 ? "" : "s"} behind the sampled reference`}</small></section>
        <section className="card"><span className="eyebrow">FLEET WITNESS</span><strong>{!witness ? "—" : witness.available ? "Available" : "Unavailable"}</strong><small>{witness?.available && witness.age_ms !== null ? `${Math.round(witness.age_ms / 1000)}s old · height ${witness.height === null ? "—" : fmtInt(witness.height)}` : witness?.reason ?? "No scheduled witness result"}</small></section>
      </div>
      <section className="card"><div className="section-heading"><div><h2>Observer & witness pool</h2><p>Passive measurements from this edge location. “Unobserved” does not mean offline.</p></div><span className="pill quiet">{data ? `${data.pool.observers + data.pool.witnesses} configured nodes` : "Reading configuration…"}</span></div>
        <div className="telemetry-tabs" role="group" aria-label="Filter nodes">{(["all", "issues", "responding"] as NodeFilter[]).map(value => <button type="button" key={value} className={nodeFilter === value ? "active" : ""} aria-pressed={nodeFilter === value} onClick={() => setNodeFilter(value)}>{value === "all" ? `All (${nodes.length})` : value === "issues" ? `Needs attention (${nodes.filter(n => nodeHasIssue(n, sampledAt)).length})` : `Responding (${nodes.filter(n => n.status === "responding").length})`}</button>)}</div>
        <div className="table-wrap"><table className="tbl node-table" aria-label="RPC observer and witness measurements"><thead><tr><th scope="col">Node</th><th scope="col">Role</th><th scope="col">Health</th><th scope="col">Latency</th><th scope="col">Head / lag</th><th scope="col">Failed / sampled</th><th scope="col">Sample age</th></tr></thead><tbody>{filteredNodes.map(n => <tr key={n.id}><th scope="row"><code>{n.id}</code></th><td>{n.role === "observer" ? "Read-only observer" : "Scheduled witness"}</td><td><span className={"pill " + (n.status === "responding" ? "info" : n.status === "unavailable" ? "warn" : "quiet")}>{n.status}</span><small className="node-outcome">{n.cooling ? "cooldown" : n.outcome ?? "not sampled"}</small></td><td className="num">{n.latency_ms === null ? "—" : `${n.latency_ms} ms`}</td><td className="num" title={n.chain ? `Head sampled ${new Date(n.chain.sampled_at).toLocaleString()}` : "No head sample"}>{n.chain?.slot == null ? "—" : <>S{fmtInt(n.chain.slot)}<small className="node-outcome">H{n.chain.height == null ? "—" : fmtInt(n.chain.height)} · lag {n.chain.lag_slots == null ? "—" : fmtInt(n.chain.lag_slots)}</small></>}{n.chain && data && data.sampled_at - n.chain.sampled_at > 60_000 ? " (older)" : ""}</td><td className="num" title={requestSuccess(n) ?? "No coherent call sample"}>{n.requests ? `${n.failures} / ${n.requests}` : "—"}</td><td>{n.age_ms === null ? "Never sampled here" : `${Math.round(n.age_ms / 1000)}s`}</td></tr>)}</tbody></table></div>
        {nodes.length > 0 && filteredNodes.length === 0 && <div className="telemetry-empty">No nodes match this filter.</div>}
        {!nodes.length && <div className="telemetry-empty">{live.loading ? "Reading RPC observations…" : "RPC telemetry is unavailable."}</div>}
        <p className="lookup-hint">Observer nodes serve explorer reads. Validators receive only scheduled chain-head witness requests. Measurements reset when an edge instance restarts and are not global uptime statistics.</p>
      </section>
      <div className="edge-counter-grid" aria-label="Edge request counters">
        <section className="card"><span className="eyebrow">CACHE EFFICIENCY</span><strong>{cacheHitRate === null ? "—" : `${cacheHitRate.toFixed(1)}%`}</strong><small>{counter(counters?.cacheHits)} hits · {counter(counters?.cacheMisses)} misses</small></section>
        <section className="card"><span className="eyebrow">UPSTREAM WORK</span><strong>{counter(counters?.archivalCalls)}</strong><small>archival · {counter(counters?.fleetCalls)} witness calls</small></section>
        <section className="card"><span className="eyebrow">COALESCED READS</span><strong>{counter(counters?.coalesced)}</strong><small>duplicate in-flight requests shared</small></section>
        <section className="card"><span className="eyebrow">PRESSURE CONTROL</span><strong>{counter(counters?.clientThrottled)}</strong><small>throttled · {counter(counters?.staleServed)} stale served</small></section>
      </div>
      <div className="build-grid">{observers.map(n => <section key={n.id} className="card build-card"><div className="section-heading"><h2>{n.id}</h2><span className="pill quiet">Build identity</span></div>{n.build ? <><p className="build-version">{n.build.build_version ?? n.build.package_version ?? "Version not reported"}</p><dl className="telemetry-dl">{[["Source digest", n.build.source_digest], ["Commit", n.build.commit], ["Commit origin", n.build.commit_source], ["Working tree", n.build.tree_state], ["Compiler", n.build.rustc], ["Build target", n.build.target]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Not reported"}</dd></div>)}</dl><p className="lookup-hint">Sampled {n.build_sampled_at ? new Date(n.build_sampled_at).toLocaleString() : "at an unknown time"}. Self-reported metadata; not remote attestation.</p></> : <div className="telemetry-empty">{n.methods.getbuildinfo?.supported === false ? "This observer does not expose getbuildinfo. A newer node build is required." : "No build identity has been observed yet."}</div>}</section>)}</div>
    </div>}
    {tab === "methods" && <section role="tabpanel" id="network-panel-methods" aria-labelledby="network-tab-methods" className="card"><div className="section-heading"><div><h2>Available read surface</h2><p>Edge support and observed node support are shown separately. Showing {filtered.length} of {methods.length} methods.</p></div><label className="method-search">Filter methods<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search RPC methods…" spellCheck={false} />{query && <button className="btn btn-sm" type="button" onClick={() => setQuery("")}>Clear</button>}</label></div><div className="table-wrap"><table className="tbl method-table" aria-label="Public JSON-RPC read methods"><thead><tr><th scope="col">Method</th><th scope="col">Purpose</th><th scope="col">Cache</th><th scope="col">Observed support</th></tr></thead><tbody>{filtered.map(m => <tr key={m.name}><th scope="row"><code>{m.name}</code>{m.optional && <span className="pill quiet">Optional</span>}</th><td>{m.summary}<div className="method-contract">{m.corroboration === "none" ? "Node-local reading" : m.corroboration === "edge" ? "Edge metadata" : `${m.corroboration} check`} · {m.cost === "walk" ? "Metered state scan" : "Low-cost read"}</div></td><td>{m.cache_class.replace(/_/g, " ")}<br />{m.cache_ttl_ms / 1000}s</td><td>{support(m, nodes, data?.sampled_at ?? Date.now())}</td></tr>)}</tbody></table></div>{!filtered.length && <div className="telemetry-empty">{data ? "No matching methods." : "Waiting for the method catalogue…"}</div>}{data && data.capabilities.absent.length > 0 && <details className="raw-reading"><summary>{data.capabilities.absent.length} intentionally absent capabilities</summary><dl className="telemetry-dl">{data.capabilities.absent.map(item => <div key={item.name}><dt><code>{item.name}</code></dt><dd>{item.why}</dd></div>)}</dl></details>}<p className="lookup-hint">The public RPC accepts one JSON-RPC 2.0 read per request. Batches and transaction broadcasting are disabled.</p></section>}
    {tab === "api" && <section role="tabpanel" id="network-panel-api" aria-labelledby="network-tab-api" className="card"><div className="section-heading"><div><h2>Explorer API</h2><p>Read-only JSON endpoints, with provenance and cache age.</p></div><a className="pill-tab" href="/api/v1/capabilities" target="_blank" rel="noreferrer">Open capabilities ↗</a></div><div className="api-resource-list">{(data?.capabilities.rest_resources ?? []).map(resource => <div key={resource}><span className="pill info">GET</span><code>/api/v1/{resource}</code></div>)}</div>{data && data.capabilities.rest_resources.length === 0 && <div className="telemetry-empty">No REST resources were advertised by this edge build.</div>}{!data && <div className="telemetry-empty">Reading the API catalogue…</div>}<div className="api-example"><span className="eyebrow">JSON-RPC · POST /rpc</span><pre>{JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getbuildinfo", params: [] }, null, 2)}</pre></div><div className="edge-counter-grid" aria-label="Public API limits"><section className="card"><span className="eyebrow">UPSTREAM BUDGET</span><strong>{data?.capabilities.limits.upstream_calls_per_second ?? "—"}</strong><small>tokens per second, per edge isolate</small></section><section className="card"><span className="eyebrow">CLIENT SUSTAINED</span><strong>{data?.capabilities.limits.client_sustained_per_second ?? "—"}</strong><small>requests per second</small></section><section className="card"><span className="eyebrow">CLIENT BURST</span><strong>{data?.capabilities.limits.client_burst ?? "—"}</strong><small>temporary request allowance</small></section><section className="card"><span className="eyebrow">WITNESS INTERVAL</span><strong>{data ? `${Math.round(data.capabilities.limits.fleet_witness_interval_ms / 1000)}s` : "—"}</strong><small>scheduled fleet corroboration</small></section></div><p className="lookup-hint">State scans cost more than simple reads. Up to {data?.pool.max_per_pool ?? "—"} observers can be configured; adding an observer requires an actual read-only node.</p></section>}
    <section className="card"><div className="section-heading"><h2>Data provenance</h2><Link to="/mempool">View mempool ↗</Link></div><p>Matching observers provide corroboration, not independent validation. A cached answer retains its source and age. Unavailable methods stay unavailable; their absence is never converted into a zero balance, an empty mempool or a confirmed transaction.</p><RawData data={live.data} label="Inspect network response, counters and provenance" /></section>
  </div>;
}
