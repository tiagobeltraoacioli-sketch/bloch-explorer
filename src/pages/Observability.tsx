// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { useLiveRead } from "../lib/liveRead";
import { peerSampleFresh } from "../lib/observabilityCloud";
import { fmtInt } from "../lib/format";
import { RawData, ReadToolbar } from "../components/telemetry";
import { Link } from "../lib/router";

type Metric = number | null;
type ObservatoryState = "live" | "partial" | "awaiting_telemetry" | "unavailable" | "unconfigured";

interface ObservabilityData {
  provider: string;
  state: ObservatoryState;
  sampled_at: number;
  coverage: { prometheus: boolean; bloch: boolean; host: boolean; kubernetes: boolean };
  prometheus: { targets_total: Metric; targets_healthy: Metric; targets_unhealthy: Metric };
  bloch: {
    nodes: Metric; head_slot: Metric; finalized_epoch: Metric; worst_lag_slots: Metric;
    peers: Metric; peer_reporting_nodes: Metric; peer_sampled_at: Metric;
    peer_p2p_connections: Metric; peer_devnet_connections: Metric;
    peer_min_per_node: Metric; peer_median_per_node: Metric; peer_max_per_node: Metric;
    mempool_transactions: Metric; blocks_per_minute: Metric;
    rejected_blocks_1h: Metric; heartbeat_age_seconds: Metric;
  };
  host: {
    nodes: Metric; cpu_busy_cores: Metric; memory_used_bytes: Metric;
    memory_total_bytes: Metric; root_disk_free_bytes: Metric;
    root_disk_min_free_percent: Metric;
  };
  kubernetes: {
    nodes: Metric; pods_running: Metric; pods_unhealthy: Metric; container_restarts: Metric;
    deployments_desired: Metric; deployments_available: Metric; cpu_cores: Metric; memory_bytes: Metric;
  };
}

interface ObservabilityResponse {
  data: ObservabilityData | null;
  state: ObservatoryState;
  sampled_at: number;
  partial?: boolean;
  queries?: { succeeded: number; failed: number; total: number };
  error?: { reason: string } | null;
}

function integer(value: Metric): string {
  return value === null ? "—" : fmtInt(Math.round(value));
}

function decimal(value: Metric, digits = 2): string {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function bytes(value: Metric): string {
  if (value === null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value, unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: amount >= 10 ? 1 : 2 })} ${units[unit]}`;
}

function age(value: Metric): string {
  if (value === null) return "—";
  if (value < 60) return `${Math.max(0, Math.round(value))}s`;
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

function StatePill({ state }: { state: ObservatoryState }) {
  const label = state === "live" ? "Live" : state === "partial" ? "Partial" :
    state === "awaiting_telemetry" ? "Awaiting telemetry" : state === "unconfigured" ? "Not configured" : "Unavailable";
  const tone = state === "live" ? "ok" : state === "partial" || state === "awaiting_telemetry" ? "warn" : "quiet";
  return <span className={`pill ${tone}`}><i className="obs-status-dot" aria-hidden="true" />{label}</span>;
}

function MetricCard({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: "neutral" | "ok" | "warn" | "info" }) {
  return <section className={`card obs-metric obs-tone-${tone}`}>
    <span className="eyebrow">{label}</span><strong>{value}</strong><small>{note}</small>
  </section>;
}

function Coverage({ active, title, note }: { active: boolean; title: string; note: string }) {
  return <div className={`obs-coverage-row ${active ? "is-active" : ""}`}>
    <i aria-hidden="true" /><div><strong>{title}</strong><small>{active ? "Metrics detected in the current sample" : note}</small></div>
    <span>{active ? "receiving" : "waiting"}</span>
  </div>;
}

export function ObservabilityPage() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
  const live = useLiveRead<ObservabilityResponse>("/api/v1/observability", 30_000);
  const response = live.data;
  const data = response?.data;
  const state = data?.state ?? response?.state ?? (live.error ? "unavailable" : "awaiting_telemetry");
  const prom = data?.prometheus;
  const bloch = data?.bloch;
  const peersFresh = peerSampleFresh(bloch?.peer_sampled_at ?? null, now);
  const host = data?.host;
  const k8s = data?.kubernetes;
  const targets = prom?.targets_total ?? null;
  const healthy = prom?.targets_healthy ?? null;
  const targetPercent = targets !== null && targets > 0 && healthy !== null ? Math.min(100, healthy / targets * 100) : null;
  const memoryUsed = host?.memory_used_bytes ?? null;
  const memoryTotal = host?.memory_total_bytes ?? null;
  const memoryPercent = memoryUsed !== null && memoryTotal !== null && memoryTotal > 0 ? Math.min(100, memoryUsed / memoryTotal * 100) : null;
  const deployments = k8s?.deployments_desired ?? null;
  const available = k8s?.deployments_available ?? null;
  const deploymentPercent = deployments !== null && deployments > 0 && available !== null ? Math.min(100, available / deployments * 100) : null;

  return <div className="container telemetry-page obs-page">
    <div className="overview-heading">
      <div><span className="eyebrow">NETWORK OPERATIONS / GRAFANA CLOUD</span><h1>Chain, hosts and cluster, one view.</h1></div>
      <ReadToolbar {...live} onRefresh={live.refresh} onPause={() => live.setPaused(!live.paused)} />
    </div>

    {live.error && <div className="errbox" role="alert">{live.error} {data ? "The panels retain the previous verified sample." : "No infrastructure reading is available yet."}</div>}
    <section className={`card obs-hero obs-state-${state}`}>
      <div className="obs-hero-copy">
        <div className="obs-hero-line"><StatePill state={state} /><span>{data?.provider ?? "Grafana Cloud Prometheus"}</span></div>
        <h2>{state === "live" ? "Telemetry is flowing." : state === "partial" ? "Some collectors need attention." : state === "awaiting_telemetry" ? "The secure data path is ready." : state === "unconfigured" ? "Cloud credentials are not configured." : "The telemetry service did not answer."}</h2>
        <p>{state === "awaiting_telemetry"
          ? "Grafana Cloud accepted the connection, but the tenant has no samples yet. Start Alloy on the validator hosts to populate this view."
          : "Fixed, aggregate PromQL runs at the edge. Credentials, host names, instance labels and arbitrary queries never reach the browser."}</p>
      </div>
      <div className="obs-radar" aria-label={`${data?.coverage ? Object.values(data.coverage).filter(Boolean).length : 0} of 4 telemetry layers detected`}>
        <i className="ring ring-a" /><i className="ring ring-b" /><i className="ring ring-c" />
        <span className="radar-core"><b>{data?.coverage ? Object.values(data.coverage).filter(Boolean).length : 0}</b><small>/ 4 layers</small></span>
        <span className={`radar-node node-a ${data?.coverage.prometheus ? "is-active" : ""}`} /><span className={`radar-node node-b ${data?.coverage.bloch ? "is-active" : ""}`} /><span className={`radar-node node-c ${data?.coverage.host ? "is-active" : ""}`} /><span className={`radar-node node-d ${data?.coverage.kubernetes ? "is-active" : ""}`} />
      </div>
    </section>

    <div className="obs-section-head"><div><span className="eyebrow">PROMETHEUS PIPELINE</span><h2>Collection integrity</h2></div><span className="obs-sampled">{data ? `Sampled ${new Date(data.sampled_at).toLocaleString()}` : "Waiting for first sample"}</span></div>
    <div className="obs-primary-grid">
      <MetricCard label="HEALTHY TARGETS" value={targets === null ? "—" : `${integer(healthy)} / ${integer(targets)}`} note={targetPercent === null ? "Waiting for service discovery" : `${targetPercent.toFixed(1)}% of discovered targets are up`} tone={targetPercent === 100 ? "ok" : targetPercent === null ? "neutral" : "warn"} />
      <MetricCard label="UNHEALTHY TARGETS" value={integer(prom?.targets_unhealthy ?? null)} note="Prometheus targets currently reporting down" tone={(prom?.targets_unhealthy ?? null) === 0 ? "ok" : "warn"} />
      <MetricCard label="QUERY COVERAGE" value={response?.queries ? `${response.queries.succeeded} / ${response.queries.total}` : "—"} note={response?.queries?.failed ? `${response.queries.failed} aggregate reads failed` : "Fixed queries completed at the edge"} tone={response?.queries?.failed ? "warn" : "info"} />
      <MetricCard label="REFRESH WINDOW" value="30s" note="Visibility-aware polling with bounded retries" tone="neutral" />
    </div>

    <div className="obs-split">
      <section className="card obs-panel">
        <div className="section-heading"><div><span className="eyebrow">BLOCH L1</span><h2>Consensus workload</h2></div><span className="pill info">Native node metrics</span></div>
        <div className="obs-readout-grid">
          <div><span>Nodes exporting</span><strong>{integer(bloch?.nodes ?? null)}</strong><small>reporting a head slot</small></div>
          <div><span>Head slot</span><strong>{integer(bloch?.head_slot ?? null)}</strong><small>highest exported slot</small></div>
          <div><span>Finalized epoch</span><strong>{integer(bloch?.finalized_epoch ?? null)}</strong><small>highest exported finality</small></div>
          <div><span>Worst lag</span><strong>{integer(bloch?.worst_lag_slots ?? null)}</strong><small>slots behind</small></div>
          <div><span>Peer connections</span><strong>{integer(peersFresh ? bloch?.peers ?? null : null)}</strong><small>{peersFresh && bloch?.peers !== null && bloch?.peers !== undefined ? `${integer(bloch.peer_reporting_nodes)} reporting nodes · samples ≤90s` : "awaiting fresh samples"}</small></div>
          <div><span>P2P connections</span><strong>{integer(peersFresh ? bloch?.peer_p2p_connections ?? null : null)}</strong><small>complete transport coverage required</small></div>
          <div><span>Devnet connections</span><strong>{integer(peersFresh ? bloch?.peer_devnet_connections ?? null : null)}</strong><small>complete transport coverage required</small></div>
          <div><span>Fewest connections</span><strong>{integer(peersFresh ? bloch?.peer_min_per_node ?? null : null)}</strong><small>one reporting node</small></div>
          <div><span>Median connections</span><strong>{decimal(peersFresh ? bloch?.peer_median_per_node ?? null : null, 1)}</strong><small>per reporting node</small></div>
          <div><span>Most connections</span><strong>{integer(peersFresh ? bloch?.peer_max_per_node ?? null : null)}</strong><small>one reporting node</small></div>
          <div><span>Mempool</span><strong>{integer(bloch?.mempool_transactions ?? null)}</strong><small>transactions observed</small></div>
          <div><span>Block pace</span><strong>{decimal(bloch?.blocks_per_minute ?? null)}</strong><small>applied per minute · 5m rate</small></div>
          <div><span>Heartbeat age</span><strong>{age(bloch?.heartbeat_age_seconds ?? null)}</strong><small>oldest exported heartbeat</small></div>
        </div>
        <p className="lookup-hint">The transport split and per-node distribution describe observed connections. A peer connected to several observers appears in several counts; these figures cannot establish the number of unique network peers. “Devnet” names a network transport, not the Genesis-4 chain stage.</p>
        <div className="obs-alert-line"><span>Rejected blocks · last hour</span><strong>{integer(bloch?.rejected_blocks_1h ?? null)}</strong></div>
      </section>

      <section className="card obs-panel">
        <div className="section-heading"><div><span className="eyebrow">HOST INFRASTRUCTURE</span><h2>Validator hosts</h2></div><span className="pill quiet">Alloy + Unix exporter</span></div>
        <div className="obs-readout-grid">
          <div><span>Hosts exporting</span><strong>{integer(host?.nodes ?? null)}</strong><small>Unix exporter samples</small></div>
          <div><span>CPU workload</span><strong>{decimal(host?.cpu_busy_cores ?? null)}</strong><small>busy cores · 5m rate</small></div>
          <div><span>Memory in use</span><strong>{bytes(memoryUsed)}</strong><small>across reporting hosts</small></div>
          <div><span>Total memory</span><strong>{bytes(memoryTotal)}</strong><small>across reporting hosts</small></div>
          <div><span>Root disk free</span><strong>{bytes(host?.root_disk_free_bytes ?? null)}</strong><small>sum across reporting hosts</small></div>
          <div><span>Lowest root free</span><strong>{host?.root_disk_min_free_percent === null || host?.root_disk_min_free_percent === undefined ? "—" : `${decimal(host.root_disk_min_free_percent, 1)}%`}</strong><small>one host can constrain the fleet</small></div>
        </div>
        <div className="obs-progress-block">
          <div><span>Memory utilization</span><strong>{memoryPercent === null ? "—" : `${decimal(memoryPercent, 1)}%`}</strong></div>
          <span className="obs-progress"><i style={{ width: `${memoryPercent ?? 0}%` }} /></span>
        </div>
      </section>
    </div>

    <section className="card obs-panel obs-cluster-panel">
      <div className="section-heading"><div><span className="eyebrow">KUBERNETES</span><h2>Cluster runtime</h2></div><span className="pill quiet">Alloy + kube-state-metrics</span></div>
      <div className="obs-readout-grid">
        <div><span>Cluster nodes</span><strong>{integer(k8s?.nodes ?? null)}</strong><small>inventory discovered</small></div>
        <div><span>Running pods</span><strong>{integer(k8s?.pods_running ?? null)}</strong><small>current running phase</small></div>
        <div><span>Unhealthy pods</span><strong>{integer(k8s?.pods_unhealthy ?? null)}</strong><small>pending, failed or unknown</small></div>
        <div><span>Restarts</span><strong>{integer(k8s?.container_restarts ?? null)}</strong><small>container restart counter</small></div>
        <div><span>CPU workload</span><strong>{decimal(k8s?.cpu_cores ?? null)}</strong><small>cores · 5m rate</small></div>
        <div><span>Working memory</span><strong>{bytes(k8s?.memory_bytes ?? null)}</strong><small>container working sets</small></div>
      </div>
      <div className="obs-progress-block">
        <div><span>Deployment availability</span><strong>{available === null || deployments === null ? "—" : `${integer(available)} / ${integer(deployments)}`}</strong></div>
        <span className="obs-progress"><i style={{ width: `${deploymentPercent ?? 0}%` }} /></span>
      </div>
    </section>

    <section className="card obs-coverage">
      <div className="section-heading"><div><h2>Telemetry coverage</h2><p>Four layers distinguish a quiet chain from a broken observation path.</p></div><Link to="/network">Inspect RPC observers ↗</Link></div>
      <Coverage active={data?.coverage.prometheus ?? false} title="Prometheus collection" note="Waiting for Alloy service discovery and the first scrape" />
      <Coverage active={data?.coverage.bloch ?? false} title="Bloch protocol metrics" note="Waiting for native bloch_pos_* metrics" />
      <Coverage active={data?.coverage.host ?? false} title="Host infrastructure" note="Waiting for Unix exporter metrics from Alloy" />
      <Coverage active={data?.coverage.kubernetes ?? false} title="Kubernetes infrastructure" note="Waiting for kube-state-metrics and cAdvisor metrics" />
      <p className="lookup-hint">This view is operational telemetry, not consensus truth. Finality and chain data remain sourced from corroborated read-only observers; infrastructure metrics explain the health of the systems carrying those reads.</p>
      <RawData data={response} label="Inspect aggregate telemetry response" />
    </section>
  </div>;
}
