// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { useLiveRead } from "../lib/liveRead";
import { ApiReading, NetworkData, Observer, RpcMethod } from "../lib/observatory";
import { fmtInt } from "../lib/format";
import { ReadToolbar, RawData } from "../components/telemetry";
import { Link } from "../lib/router";

function support(method: RpcMethod, nodes: Observer[], now: number): string {
  const samples = nodes.filter(n => n.role === "observer").map(n => n.methods[method.name]).filter(s => s && now - s.sampled_at <= 120_000);
  const yes = samples.filter(s => s.supported === true).length;
  if (method.corroboration === "edge") return "Answered by edge";
  if (yes) return `Observed on ${yes} ${yes === 1 ? "node" : "nodes"}`;
  if (samples.some(s => s.supported === false)) return "Not supported in sampled responses";
  return "Not recently observed";
}

export function NetworkPage() {
  const live = useLiveRead<ApiReading<NetworkData>>("/api/v1/network", 30_000);
  const [tab, setTab] = useState("nodes");
  const [query, setQuery] = useState("");
  const data = live.data?.data;
  const nodes = data?.nodes ?? [];
  const observers = nodes.filter(n => n.role === "observer").map(n => {
    const cached = data?.build;
    if (n.build || !cached?.data || cached.corroboration.source_node !== n.id) return n;
    return { ...n, build: cached.data, build_sampled_at: (data?.sampled_at ?? Date.now()) - (cached.cache.age_ms ?? 0) };
  });
  const methods = data?.capabilities.methods ?? [];
  const filtered = methods.filter(m => `${m.name} ${m.summary}`.toLowerCase().includes(query.toLowerCase()));
  const recent = observers.filter(n => n.status === "responding");
  const head = data?.head.data;
  const planeFresh = data?.plane.age_ms != null && data.plane.age_ms <= 40_000;
  return <div className="container telemetry-page">
    <div className="overview-heading"><div><span className="eyebrow">INFRASTRUCTURE / DATA SOURCES</span><h1>Behind every reading.</h1></div><ReadToolbar {...live} onRefresh={live.refresh} onPause={() => live.setPaused(!live.paused)} /></div>
    {live.error && <div className="errbox" role="alert">{live.error} {data ? "The panels retain the previous snapshot." : ""}</div>}
    {data?.head.error && <div className="data-warning" role="status">The chain head could not be refreshed: {data.head.error.message ?? "read unavailable"}. Passive RPC observations remain available.</div>}
    <div className="telemetry-metrics">
      <section className="card metric-panel"><span className="eyebrow">RESPONDING OBSERVERS</span><strong>{data ? `${recent.length} / ${observers.length}` : "—"}</strong><span>From RPC calls sampled in the last minute</span></section>
      <section className="card metric-panel"><span className="eyebrow">HEAD SLOT</span><strong>{head ? fmtInt(head.slot) : "—"}</strong><span>{head ? `Height ${fmtInt(head.height)} · epoch ${fmtInt(head.epoch)}` : "Waiting for a chain reading"}</span></section>
      <section className="card metric-panel"><span className="eyebrow">READ METHODS</span><strong>{data ? methods.length : "—"}</strong><span>{methods.filter(m => m.optional).length} optional methods depend on the node version</span></section>
      <section className="card metric-panel"><span className="eyebrow">LINEAGE CHECK</span><strong className="metric-word">{!data ? "—" : !planeFresh ? "Outdated" : data.plane.certified ? "Matched" : "Unverified"}</strong><span>{data?.plane.reason ?? "Observer lineage compared with a scheduled witness"}</span></section>
    </div>
    <div className="telemetry-tabs" role="group" aria-label="Network views">{[["nodes", "RPC nodes"], ["methods", "Method catalogue"], ["api", "Public API"]].map(([id, title]) => <button key={id} type="button" className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>{title}</button>)}</div>
    {tab === "nodes" && <>
      <section className="card"><div className="section-heading"><div><h2>Observer & witness pool</h2><p>Passive measurements from this edge location. “Unobserved” does not mean offline.</p></div><span className="pill quiet">{data ? `${data.pool.observers + data.pool.witnesses} configured nodes` : "Reading configuration…"}</span></div>
        <div className="table-wrap"><table className="tbl node-table"><thead><tr><th>Node</th><th>Role</th><th>Last response</th><th>Latency</th><th>Head slot</th><th>Failed / sampled</th><th>Sample age</th></tr></thead><tbody>{nodes.map(n => <tr key={n.id}><td><code>{n.id}</code></td><td>{n.role === "observer" ? "Read-only observer" : "Scheduled witness"}</td><td><span className={"pill " + (n.status === "responding" ? "info" : n.status === "unavailable" ? "warn" : "quiet")}>{n.status}</span></td><td className="num">{n.latency_ms === null ? "—" : `${n.latency_ms} ms`}</td><td className="num" title={n.chain ? `Head sampled ${new Date(n.chain.sampled_at).toLocaleString()}` : "No head sample"}>{n.chain?.slot == null ? "—" : fmtInt(n.chain.slot)}{n.chain && data && data.sampled_at - n.chain.sampled_at > 60_000 ? " (older)" : ""}</td><td className="num">{n.requests ? `${n.failures} / ${n.requests}` : "—"}</td><td>{n.age_ms === null ? "Never sampled here" : `${Math.round(n.age_ms / 1000)}s`}</td></tr>)}</tbody></table></div>
        {!nodes.length && <div className="telemetry-empty">{live.loading ? "Reading RPC observations…" : "RPC telemetry is unavailable."}</div>}
        <p className="lookup-hint">Observer nodes serve explorer reads. Validators receive only scheduled chain-head witness requests. Measurements reset when an edge instance restarts and are not global uptime statistics.</p>
      </section>
      <div className="build-grid">{observers.map(n => <section key={n.id} className="card build-card"><div className="section-heading"><h2>{n.id}</h2><span className="pill quiet">Build identity</span></div>{n.build ? <><p className="build-version">{n.build.build_version ?? n.build.package_version ?? "Version not reported"}</p><dl className="telemetry-dl">{[["Source digest", n.build.source_digest], ["Commit", n.build.commit], ["Commit origin", n.build.commit_source], ["Working tree", n.build.tree_state], ["Compiler", n.build.rustc], ["Build target", n.build.target]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Not reported"}</dd></div>)}</dl><p className="lookup-hint">Sampled {n.build_sampled_at ? new Date(n.build_sampled_at).toLocaleString() : "at an unknown time"}. Self-reported metadata; not remote attestation.</p></> : <div className="telemetry-empty">{n.methods.getbuildinfo?.supported === false ? "This observer does not expose getbuildinfo. A newer node build is required." : "No build identity has been observed yet."}</div>}</section>)}</div>
    </>}
    {tab === "methods" && <section className="card"><div className="section-heading"><div><h2>Available read surface</h2><p>Edge support and observed node support are shown separately.</p></div><label className="method-search">Filter methods<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search RPC methods…" /></label></div><div className="table-wrap"><table className="tbl method-table"><thead><tr><th>Method</th><th>Purpose</th><th>Cache</th><th>Observed support</th></tr></thead><tbody>{filtered.map(m => <tr key={m.name}><td><code>{m.name}</code>{m.optional && <span className="pill quiet">Optional</span>}</td><td>{m.summary}<div className="method-contract">{m.corroboration === "none" ? "Node-local reading" : m.corroboration === "edge" ? "Edge metadata" : `${m.corroboration} check`} · {m.cost === "walk" ? "Metered state scan" : "Low-cost read"}</div></td><td>{m.cache_class.replace(/_/g, " ")}<br />{m.cache_ttl_ms / 1000}s</td><td>{support(m, nodes, data?.sampled_at ?? Date.now())}</td></tr>)}</tbody></table></div>{!filtered.length && <div className="telemetry-empty">{data ? "No matching methods." : "Waiting for the method catalogue…"}</div>}<p className="lookup-hint">The public RPC accepts one JSON-RPC 2.0 read per request. Batches and transaction broadcasting are disabled.</p></section>}
    {tab === "api" && <section className="card"><div className="section-heading"><div><h2>Explorer API</h2><p>Read-only JSON endpoints, with provenance and cache age.</p></div><a className="pill-tab" href="/api/v1/capabilities" target="_blank" rel="noreferrer">Open capabilities ↗</a></div><div className="api-resource-list">{(data?.capabilities.rest_resources ?? []).map(resource => <div key={resource}><span className="pill info">GET</span><code>/api/v1/{resource}</code></div>)}</div><div className="api-example"><span className="eyebrow">JSON-RPC · POST /rpc</span><pre>{JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getbuildinfo", params: [] }, null, 2)}</pre></div><p className="lookup-hint">Configured upstream budget: {data?.capabilities.limits.upstream_calls_per_second ?? "—"} tokens/second per edge isolate. State scans cost more than simple reads. Up to {data?.pool.max_per_pool ?? "—"} observers can be configured; adding an observer requires an actual read-only node.</p></section>}
    <section className="card"><div className="section-heading"><h2>Data provenance</h2><Link to="/mempool">View mempool ↗</Link></div><p>Matching observers provide corroboration, not independent validation. A cached answer retains its source and age. Unavailable methods stay unavailable; their absence is never converted into a zero balance, an empty mempool or a confirmed transaction.</p><RawData data={live.data} label="Inspect network response, counters and provenance" /></section>
  </div>;
}
