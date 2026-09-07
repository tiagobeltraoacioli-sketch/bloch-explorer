// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The instrument kit: the small readout components every data-heavy page is
// built from, so a KPI tile or a slot strip looks the same wherever a reader
// meets it. Presentation only — nothing here fetches, and nothing here
// changes a number it was handed.
import { ReactNode } from "react";
import { Link } from "../lib/router";
import { SlotCell } from "../lib/slots";
import { EpochTier } from "../lib/epochs";
import { NOT_CANONICAL } from "../lib/g4";
import { fmtInt, short, timeAgo } from "../lib/format";

/** A KPI tile: an eyebrow, a mono figure, an optional qualifying line. */
export function Kpi({
  k,
  v,
  unit,
  sub,
  tone,
  tag,
  title,
  children,
}: {
  k: ReactNode;
  v: ReactNode;
  unit?: string;
  sub?: ReactNode;
  /** `accent` for the headline figure, `warn`/`crit` when the number is bad news, `absent` for a figure the node does not serve. */
  tone?: "accent" | "warn" | "crit" | "absent";
  /** A small pill in the corner — "node-local", "at floor", … */
  tag?: ReactNode;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="kpi" title={title}>
      <span className="k">{k}</span>
      <b className={tone ?? ""}>
        {v}
        {unit && <span className="u">{unit}</span>}
      </b>
      {sub != null && <small>{sub}</small>}
      {tag != null && <span className="kpi-tag">{tag}</span>}
      {children}
    </div>
  );
}

/** Where an epoch sits against the head's checkpoints — a reading, never "settled". */
export function TierPill({ tier }: { tier: EpochTier }) {
  const copy: Record<EpochTier, [string, string, string]> = {
    final: ["ok", "finalized", "Reported finalized by the head this page read. Not a latch: on this chain a finalized checkpoint can move down."],
    justified: ["info", "justified", "Attested by a supermajority, one step short of finalized. Reorganisable."],
    building: ["quiet", "building", "Not yet justified. Freely reorganisable."],
    future: ["quiet", "not yet", "The head has not reached this epoch."],
  };
  const [tone, label, title] = copy[tier];
  return (
    <span className={"pill " + tone} title={title}>
      {label}
    </span>
  );
}

function cellTitle(c: SlotCell): string {
  if (c.kind === "empty") return `slot ${fmtInt(c.slot)} — no block: the proposer missed it`;
  if (c.kind === "unknown") return `slot ${fmtInt(c.slot)} — not read (${c.why}). Says nothing about whether a block exists here.`;
  const b = c.block;
  return `slot ${fmtInt(b.slot)} · height ${b.height === null ? "—" : fmtInt(b.height)} · proposer v${b.proposer_index} · ${b.attestation_count} att · ${b.tx_count} tx · ${b.finality} · ${timeAgo(b.timestamp)} · ${short(b.block_id, 10, 6)}`;
}

/**
 * One cell per slot. Three states that must read apart at a glance, and a
 * fourth — "the head has not reached this slot" — that must not look like
 * any of them. Ink height inside a block cell is attestations included,
 * against the most any cell in the strip carried.
 */
export function SlotStrip({
  cells,
  pending = 0,
  current,
  variant = "",
  linkTo = (s) => `/slot/${s}`,
}: {
  /** Ascending by slot. */
  cells: SlotCell[];
  /** Slots after the last cell that the head has not reached yet. */
  pending?: number;
  /** A slot to ring — the page's own block, or the head. */
  current?: number;
  variant?: "" | "tall" | "dense" | "mini";
  linkTo?: (slot: number) => string;
}) {
  const maxAtt = Math.max(1, ...cells.map((c) => (c.kind === "block" ? c.block.attestation_count : 0)));
  return (
    <div className={"slot-strip" + (variant ? " " + variant : "")} role="img" aria-label={`${cells.length} slots`}>
      {cells.map((c) => {
        const cls = ["slot-cell"];
        if (c.kind === "block") {
          cls.push("is-block");
          if (c.block.tx_count > 0) cls.push("has-tx");
          if (c.block.finality === NOT_CANONICAL) cls.push("is-orphan");
        } else cls.push(c.kind === "empty" ? "is-empty" : "is-unknown");
        if (current === c.slot) cls.push("is-current");
        const ink =
          c.kind === "block" ? Math.max(0.28, c.block.attestation_count / maxAtt) : 0;
        return (
          <Link key={c.slot} to={linkTo(c.slot)} className={cls.join(" ")} title={cellTitle(c)}>
            {c.kind === "block" && <span className="ink" style={{ height: `${Math.round(ink * 100)}%` }} />}
          </Link>
        );
      })}
      {Array.from({ length: Math.max(0, pending) }, (_, i) => (
        <span key={"p" + i} className="slot-cell is-pending" title="the head has not reached this slot" />
      ))}
    </div>
  );
}

export function StripLegend({ pending, tx = true }: { pending?: boolean; tx?: boolean }) {
  return (
    <div className="strip-legend">
      <span className="item"><i className="sw block" /> block · ink is attestations included</span>
      {tx && <span className="item"><i className="sw tx" /> block carrying transactions</span>}
      <span className="item"><i className="sw empty" /> missed — the chain said no block</span>
      <span className="item"><i className="sw unknown" /> unread — we could not find out</span>
      {pending && <span className="item"><i className="sw pending" /> not reached yet</span>}
    </div>
  );
}

/** Who proposed how much in a window, largest first. Counts first; the share is a texture. */
export function ProposerBars({
  proposers,
  blocks,
  limit = 12,
}: {
  proposers: Map<number, number>;
  blocks: number;
  limit?: number;
}) {
  const rows = [...proposers.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit);
  if (rows.length === 0) return <p className="lookup-hint">No blocks in this window yet.</p>;
  const max = rows[0][1];
  return (
    <div className="prop-list">
      {rows.map(([idx, n]) => (
        <div className="prop-row" key={idx}>
          <Link to={`/validators/${idx}`} className="mono-link prop-v">v{idx}</Link>
          <div className="prop-track">
            <div className="prop-fill" style={{ width: `${(n / max) * 100}%` }} />
          </div>
          <span className="prop-n">{fmtInt(n)}</span>
          <span className="prop-pct">{blocks ? ((n / blocks) * 100).toFixed(1) : "0.0"}%</span>
        </div>
      ))}
    </div>
  );
}

/** A tiny sparkline over plain numbers — pixels, never money. */
export function Spark({ values, height = 40 }: { values: number[]; height?: number }) {
  if (values.length < 2) return <div className="sparkline" style={{ height }} />;
  const W = 300;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    3 + (1 - (v - min) / span) * (height - 6),
  ]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div className="sparkline" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="spark-fill" d={`${line} L${W} ${height} L0 ${height} Z`} />
        <path className="spark-line" d={line} />
        <circle className="spark-dot" cx={last[0]} cy={last[1]} r="3" />
      </svg>
    </div>
  );
}

/** A count that says how many of what, without a bare number ever standing alone. */
export function Tally({ n, one, many }: { n: number; one: string; many: string }) {
  return (
    <>
      {fmtInt(n)} {n === 1 ? one : many}
    </>
  );
}
