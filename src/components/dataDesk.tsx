// SPDX-License-Identifier: AGPL-3.0-or-later
import { fmtInt, timeAgo } from "../lib/format";
import type { ObservabilitySummary } from "../lib/observabilityCloud";
import { Link } from "../lib/router";

function count(value: number | null | undefined): string {
  return value == null ? "—" : fmtInt(Math.round(value));
}

function percent(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

export function DataDesk({ summary }: { summary: ObservabilitySummary | null }) {
  const sampled = summary?.sampledAt;
  return <section className="data-desk" aria-labelledby="data-desk-title">
    <div className="data-desk-heading">
      <div>
        <span className="eyebrow">BLOCH INC. / NETWORK INTELLIGENCE</span>
        <h2 id="data-desk-title">The operating picture.</h2>
        <p>Independent infrastructure measurements alongside the chain's own state. Each number links to its source and scope.</p>
      </div>
      <Link to="/observability" className="data-desk-link">Explore all telemetry <span aria-hidden="true">↗</span></Link>
    </div>
    <div className="data-desk-grid">
      <Link to="/observability" className="data-desk-card">
        <span className="data-desk-index">01 / COLLECTION</span>
        <strong>{count(summary?.targetsHealthy)}<small> / {count(summary?.targetsTotal)}</small></strong>
        <span className="data-desk-label">healthy scrape targets</span>
        <span className="data-desk-detail">Prometheus targets responding in the latest sample</span>
      </Link>
      <Link to="/observability" className="data-desk-card">
        <span className="data-desk-index">02 / PROTOCOL</span>
        <strong>{count(summary?.blochNodes)}</strong>
        <span className="data-desk-label">Bloch nodes observed</span>
        <span className="data-desk-detail">{summary?.blocksPerMinute == null ? "—" : summary.blocksPerMinute.toFixed(1)} blocks/min · worst head lag {count(summary?.worstLagSlots)} {summary?.worstLagSlots === 1 ? "slot" : "slots"} · {count(summary?.rejectedBlocks1h)} rejected blocks in 1h</span>
      </Link>
      <Link to="/observability" className="data-desk-card">
        <span className="data-desk-index">03 / HOSTS</span>
        <strong>{count(summary?.hostNodes)}</strong>
        <span className="data-desk-label">hosts sending metrics</span>
        <span className="data-desk-detail">{summary?.hostMemoryUsedBytes != null && summary.hostMemoryTotalBytes ? percent(summary.hostMemoryUsedBytes / summary.hostMemoryTotalBytes * 100) : "—"} memory used · lowest root disk free {percent(summary?.rootDiskMinFreePercent)}</span>
      </Link>
      <Link to="/observability" className="data-desk-card">
        <span className="data-desk-index">04 / KUBERNETES</span>
        <strong>{count(summary?.kubernetesNodes)}</strong>
        <span className="data-desk-label">cluster nodes observed</span>
        <span className="data-desk-detail">{count(summary?.podsRunning)} running pods · {count(summary?.podsUnhealthy)} unhealthy · {count(summary?.deploymentsAvailable)}/{count(summary?.deploymentsDesired)} deployments available</span>
      </Link>
    </div>
    <div className="data-desk-foot">
      <span>Source: Grafana Cloud Prometheus · monitored endpoints only</span>
      <span>{sampled == null ? "Waiting for the first sample" : `Sampled ${timeAgo(sampled / 1000)}`} · {summary ? `${summary.layers}/4 telemetry layers` : "telemetry pending"}</span>
    </div>
  </section>;
}
