// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react';
export interface PlotSeries { name: string; values: (number | null)[]; color: string; dashed?: boolean }
export function AtlasChart({ series, labels, title, breaks = [], unit = '' }: { series: PlotSeries[]; labels: string[]; title: string; breaks?: boolean[]; unit?: string }) {
  const [cursor, setCursor] = useState<number | null>(null);
  const values = series.flatMap(s => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  if (!values.length) return <div className="atlas-empty">No observations available for this window.</div>;
  const low = Math.min(...values), high = Math.max(...values), pad = (high - low) * .12 || Math.max(1, high * .01), min = low - pad, max = high + pad;
  const x = (i: number) => 52 + i / Math.max(1, labels.length - 1) * 622;
  const y = (v: number) => 177 - (v - min) / (max - min) * 152;
  const number = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1, notation: Math.abs(v) > 99999 ? 'compact' : 'standard' });
  const at = cursor !== null ? Math.min(cursor, labels.length - 1) : null;
  return <div className="atlas-line-chart">
    <svg viewBox="0 0 710 220" role="img" aria-label={title} onPointerLeave={() => setCursor(null)} onPointerMove={e => { const rect = e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(labels.length - 1, Math.round(((e.clientX - rect.left) / rect.width * 710 - 52) / 622 * (labels.length - 1))))); }}>
      <title>{title}. {labels.length} sample positions. Missing points and changes in reporting coverage break the line.</title>
      {[0, .5, 1].map(t => <g key={t}><line x1="52" x2="674" y1={25 + 152 * t} y2={25 + 152 * t} stroke="var(--atlas-line)" strokeDasharray="3 5" /><text x="43" y={29 + 152 * t} textAnchor="end">{number(max - (max - min) * t)}</text></g>)}
      {series.map(s => { let path = '', previous = false; s.values.forEach((v, i) => { if (v === null || !Number.isFinite(v)) { previous = false; return; } path += `${previous && !breaks[i] ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; previous = true; }); return <g key={s.name}><path d={path} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '5 5' : undefined} />{s.values.map((v, i) => v !== null && Number.isFinite(v) && <circle key={i} cx={x(i)} cy={y(v)} r={labels.length > 100 ? 1.2 : 1.9} fill={s.color} />)}</g>; })}
      {[0, Math.floor((labels.length - 1) / 2), labels.length - 1].map((i, j) => <text key={j} x={x(i)} y="207" textAnchor={j === 0 ? 'start' : j === 2 ? 'end' : 'middle'}>{labels[i]}</text>)}
      {at !== null && <line x1={x(at)} x2={x(at)} y1="18" y2="183" stroke="var(--fg)" opacity=".45" />}
    </svg>
    <div className="atlas-chart-legend">{series.map(s => <span key={s.name}><i style={{ background: s.color }} />{s.name}{at !== null ? ` ${s.values[at] == null ? 'unavailable' : number(s.values[at]!)} ${unit}` : ''}</span>)}{at !== null && <span>{labels[at]} UTC</span>}</div>
    <input className="atlas-scrubber" type="range" min="0" max={Math.max(0, labels.length - 1)} value={at ?? 0} onChange={e => setCursor(Number(e.target.value))} aria-label={`Inspect ${title} sample`} aria-valuetext={at === null ? 'Choose a sample' : `${labels[at]} UTC. ${series.map(s => `${s.name}: ${s.values[at] ?? 'unavailable'} ${unit}`).join('. ')}`} />
  </div>;
}
