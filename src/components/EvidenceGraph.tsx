// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useRef, useState } from 'react';
import type { EvidenceGraph as GraphData, GraphNode } from '../lib/intelligence';

const colors: Record<GraphNode['kind'], string> = { address: 'var(--atlas-purple)', transaction: 'var(--atlas-lime)', script: 'var(--atlas-purple)', outpoint: 'var(--atlas-blue)', block: 'var(--atlas-lime)', validator: 'var(--atlas-orange)' };
function layout(graph: GraphData, radial: boolean) {
  const count = graph.nodes.length;
  const nodes = graph.nodes.map((node, i) => {
    const angle = i * 2.3999632297, radius = 25 + Math.sqrt((i + .5) / Math.max(1, count)) * 178;
    return { ...node, x: 360 + Math.cos(angle) * radius * 1.55, y: 215 + Math.sin(angle) * radius, vx: 0, vy: 0 };
  });
  const byId = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = graph.edges.map(e => ({ ...e, a: byId.get(e.source)!, b: byId.get(e.target)! })).filter(e => e.a !== undefined && e.b !== undefined);
  if (radial) {
    const groups = [...new Set(nodes.map(n => n.kind))];
    groups.forEach((kind, group) => {
      const members = nodes.filter(n => n.kind === kind), radius = groups.length === 1 ? 170 : group === 0 ? 105 : 188;
      members.forEach((n, i) => { const a = i / members.length * Math.PI * 2 - Math.PI / 2; n.x = 360 + Math.cos(a) * radius * 1.55; n.y = 215 + Math.sin(a) * radius; });
    });
  } else {
    for (let tick = 0; tick < 55; tick++) {
      const cool = 1 - tick / 65;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 12;
        const f = Math.min(1.7, 18 / d2) * cool;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      edges.forEach(e => { const a = nodes[e.a], b = nodes[e.b], dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || 1, f = (distance - 42) / distance * .045;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; });
      nodes.forEach(n => { n.vx = (n.vx + (360 - n.x) * .009) * .58; n.vy = (n.vy + (215 - n.y) * .013) * .58;
        n.x += n.vx; n.y += n.vy; });
    }
    // Fit the settled geometry as a whole; clamping individual nodes would
    // manufacture a rectangular boundary and hide structural neighborhoods.
    if (nodes.length) {
      const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
      const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
      const scale = Math.min(630 / Math.max(1, right - left), 345 / Math.max(1, bottom - top), 1.5);
      nodes.forEach(n => { n.x = 360 + (n.x - (left + right) / 2) * scale; n.y = 215 + (n.y - (top + bottom) / 2) * scale; });
      // Collision relaxation keeps record targets individually selectable.
      for (let tick = 0; tick < 35; tick++) for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], dx = a.x - b.x || .01, dy = a.y - b.y || .01;
        const distance = Math.hypot(dx, dy), minimum = Math.min(16, 3 + Math.sqrt(a.weight) * 2.1) + Math.min(16, 3 + Math.sqrt(b.weight) * 2.1) + 4;
        if (distance < minimum) { const push = (minimum - distance) / distance * .51; a.x += dx * push; a.y += dy * push; b.x -= dx * push; b.y -= dy * push; }
      }
    }
  }
  return { nodes, edges };
}

export function EvidenceGraph({ graph, label, radial = false, omittedLabel = 'IO records', emptyLabel = 'Waiting for verified graph records.' }: { graph: GraphData; label: string; radial?: boolean; omittedLabel?: string; emptyLabel?: string }) {
  const [selected, setSelected] = useState<string | null>(null), [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const positioned = useMemo(() => layout(graph, radial), [graph, radial]);
  const focus = positioned.nodes.find(n => n.id === selected);
  const adjacent = new Set([selected]);
  if (selected) graph.edges.forEach(e => { if (e.source === selected) adjacent.add(e.target); if (e.target === selected) adjacent.add(e.source); });
  return <div className="atlas-graph">
    <div className="atlas-graph-tools"><span>{graph.nodes.length} nodes · {graph.edges.length} edges</span><div>
      <button type="button" aria-label={`Zoom out ${label}`} onClick={() => setZoom(z => Math.max(.65, z - .25))}>−</button>
      <button type="button" aria-label={`Reset ${label}`} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setSelected(null); }}>Fit</button>
      <button type="button" aria-label={`Zoom in ${label}`} onClick={() => setZoom(z => Math.min(3, z + .25))}>+</button>
    </div></div>
    {graph.nodes.length ? <svg viewBox="0 0 720 430" role="group" aria-label={label} className="atlas-network-svg"
      onPointerDown={e => { if ((e.target as Element).closest('[data-node]')) return; const r = e.currentTarget.getBoundingClientRect(); drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.ratio = String(720 / r.width); }}
      onPointerMove={e => { if (drag.current) { const ratio = Number(e.currentTarget.dataset.ratio); setPan({ x: drag.current.px + (e.clientX - drag.current.x) * ratio, y: drag.current.py + (e.clientY - drag.current.y) * ratio }); } }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <title>{label}. Select a node to inspect its evidence. Drag the background to pan.</title>
      <g transform={`translate(${360 + pan.x} ${215 + pan.y}) scale(${zoom}) translate(-360 -215)`}>
        {positioned.edges.map((e, i) => { const a = positioned.nodes[e.a], b = positioned.nodes[e.b], active = !focus || e.source === selected || e.target === selected; return <path key={i} d={`M${a.x},${a.y} Q${(a.x + b.x) / 2 + (radial ? 25 : 0)},${(a.y + b.y) / 2 - (radial ? 25 : 0)} ${b.x},${b.y}`} fill="none" stroke={colors[a.kind]} strokeWidth={active && focus ? 1.6 : .65} opacity={active ? focus ? .8 : .3 : .06} />; })}
        {positioned.nodes.map(n => <g key={n.id} data-node={n.id} role="button" tabIndex={0} aria-label={`${n.kind} ${n.label}. ${n.detail}`} aria-pressed={n.id === selected}
          onClick={() => setSelected(id => id === n.id ? null : n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(n.id); } if (e.key === 'Escape') setSelected(null); }}
          className="atlas-graph-node" opacity={!focus || adjacent.has(n.id) ? 1 : .16}>
          <title>{n.kind}: {n.label}\n{n.detail}</title>
          <circle cx={n.x} cy={n.y} r={Math.min(16, 3 + Math.sqrt(n.weight) * 2.1) + 5} fill={colors[n.kind]} opacity=".09" pointerEvents="none" />
          <circle cx={n.x} cy={n.y} r={Math.min(16, 3 + Math.sqrt(n.weight) * 2.1)} fill={colors[n.kind]} stroke={n.id === selected ? 'var(--fg)' : 'var(--atlas-panel)'} strokeWidth={n.id === selected ? 2 : 1.3} />
          {(n.id === selected || (positioned.nodes.length < 65 && n.kind === 'transaction')) && <text x={n.x} y={n.y + 24} textAnchor="middle" className="atlas-node-label">{n.label}</text>}
        </g>)}
      </g>
    </svg> : <div className="atlas-empty">{emptyLabel}</div>}
    <div className="atlas-graph-inspector" aria-live="polite">{focus ? <><span><b>{focus.kind.toUpperCase()} / {focus.label}</b><small>{focus.detail}</small></span><a href={focus.href}>Open record ↗</a></> : <><span>Select a node to follow the evidence</span><span>Drag to pan · + to zoom</span></>}</div>
    {graph.omitted > 0 && <small className="atlas-caption">{graph.omitted.toLocaleString()} {omittedLabel} omitted from this bounded view. Open receipts for complete records.</small>}
  </div>;
}
