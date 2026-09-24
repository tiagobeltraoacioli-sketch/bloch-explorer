// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { g4HeadWithMeta, type G4Head, type G4Corroboration } from '../lib/g4';
import { pollWhileVisible } from '../lib/polling';
import { slotWindow, type SlotCell } from '../lib/slots';
import { indexedHolders, indexedTransactions } from '../lib/indexer';
import { graphusHoldersPage, type GraphusHoldersPage } from '../lib/graphus';
import { parseSpaceSeries, parseReceiptSample, receiptGraph, clusterReceipts, evaluateSeries, type SpaceSeries, type ReceiptSample, type EvidenceGraph as GraphData } from '../lib/intelligence';
import { EvidenceGraph } from '../components/EvidenceGraph';
import { AtlasChart } from '../components/AtlasChart';
import { CorroborationBadge } from '../components/corroboration';
import { Link } from '../lib/router';
import { fmtInt, fmtBloch } from '../lib/format';
import '../intelligence.css';

type Reading<T> = { data: T | null; at: number | null; error: string | null };
const empty = <T,>(): Reading<T> => ({ data: null, at: null, error: null });
const palette = ['var(--atlas-lime)', 'var(--atlas-purple)', 'var(--atlas-blue)', 'var(--atlas-orange)'];
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-4)}`;
const time = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const stamp = (at: number | null) => at === null ? 'Awaiting source' : new Date(at).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' UTC';
function exportFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Panel({ id, index, title, sub, action, children, className = '' }: { id?: string; index: string; title: string; sub: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section id={id} className={`atlas-panel ${className}`}><header className="atlas-panel-head"><div><span className="atlas-section-index">{index}</span><h2>{title}</h2><p>{sub}</p></div>{action}</header>{children}</section>;
}
function Status({ reading, name, now }: { reading: Reading<unknown>; name: string; now: number }) {
  const stale = reading.at !== null && now - reading.at > 150000;
  return <span className={`atlas-source-status ${reading.error || stale ? 'is-stale' : reading.data ? 'is-ready' : ''}`} title={reading.error ?? stamp(reading.at)}><i />{name} / {reading.error || stale ? reading.data ? 'last snapshot' : 'unavailable' : reading.data ? 'loaded' : 'loading'}</span>;
}

export function IntelligencePage() {
  const [head, setHead] = useState<Reading<{ head: G4Head; corroboration: G4Corroboration | null }>>(empty);
  const [receipts, setReceipts] = useState<Reading<ReceiptSample>>(empty);
  const [holders, setHolders] = useState<Reading<GraphusHoldersPage>>(empty);
  const [space, setSpace] = useState<Reading<SpaceSeries>>(empty);
  const [cells, setCells] = useState<SlotCell[]>([]), [period, setPeriod] = useState('24h'), [mode, setMode] = useState<'outpoints' | 'scripts'>('outpoints');
  const [filter, setFilter] = useState('all'), [refresh, setRefresh] = useState(0), [now, setNow] = useState(Date.now());
  useEffect(() => { const clock = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(clock); }, []);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    const stop = pollWhileVisible(async () => {
      try { const reading = await g4HeadWithMeta({ signal: controller.signal }); if (stopped) return;
        setHead({ data: { head: reading.result, corroboration: reading.corroboration }, at: Date.now(), error: null });
        const result = await slotWindow(Math.max(0, reading.result.slot - 23), reading.result.slot, { signal: controller.signal, fresh: s => s > reading.result.slot - 4 });
        if (!stopped) setCells(result);
      } catch (error) { if (!stopped) setHead(prev => ({ ...prev, error: error instanceof Error ? error.message : 'Chain read unavailable' })); }
    }, 30000);
    return () => { stopped = true; controller.abort(); stop(); };
  }, [refresh]);
  useEffect(() => {
    let stopped = false;
    const stop = pollWhileVisible(async () => {
      const [tx, balance] = await Promise.allSettled([indexedTransactions(undefined, 48), indexedHolders(64)]);
      if (stopped) return;
      const sample = tx.status === 'fulfilled' ? parseReceiptSample(tx.value) : null;
      const page = balance.status === 'fulfilled' ? graphusHoldersPage(balance.value) : null;
      setReceipts(prev => sample ? { data: sample, at: Date.now(), error: null } : { ...prev, error: 'Indexed receipts unavailable or invalid.' });
      setHolders(prev => page ? { data: page, at: Date.now(), error: null } : { ...prev, error: 'Indexed balances unavailable or invalid.' });
    }, 60000);
    return () => { stopped = true; stop(); };
  }, [refresh]);
  useEffect(() => {
    let stopped = false; let controller = new AbortController(); setSpace(empty());
    const stop = pollWhileVisible(async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try { const response = await fetch(`/research?period=${period}`, { signal: controller.signal }); if (!response.ok) throw new Error(`Shared telemetry unavailable (${response.status})`);
        const data = parseSpaceSeries(await response.json(), period); if (!data) throw new Error('Invalid Bloch Space series');
        if (!stopped) setSpace({ data, at: Date.now(), error: null });
      } catch (error) { if (!stopped) setSpace(prev => ({ ...prev, error: error instanceof Error ? error.message : 'Series unavailable' })); }
      finally { clearTimeout(timeout); }
    }, 60000);
    return () => { stopped = true; controller.abort(); stop(); };
  }, [period, refresh]);

  const transactions = receipts.data?.transactions ?? [];
  const kinds = [...new Set(transactions.map(tx => tx.kind))];
  const filtered = useMemo(() => transactions.filter(tx => filter === 'all' || tx.kind === filter), [receipts.data, filter]);
  const graph = useMemo(() => receiptGraph(filtered, mode), [filtered, mode]);
  const scriptGraph = useMemo(() => receiptGraph(filtered, 'scripts'), [filtered]);
  const clusters = useMemo(() => clusterReceipts(filtered), [filtered]);
  const points = space.data?.points ?? [];
  const model = useMemo(() => evaluateSeries(points), [space.data]);
  const blockGraph = useMemo<GraphData>(() => {
    const nodes: GraphData['nodes'] = [], edges: GraphData['edges'] = [], seen = new Set<string>();
    const blocks = cells.flatMap(c => c.kind === 'block' ? [c.block] : []);
    for (const b of blocks) { const id = `b:${b.block_id}`, proposer = `v:${b.proposer_index}`;
      nodes.push({ id, label: `S${b.slot}`, kind: 'block', href: `/block/${b.block_id}`, detail: `Proposer ${b.proposer_index} · ${b.tx_count} transactions · ${b.finality}`, weight: 2 });
      if (!seen.has(proposer)) { nodes.push({ id: proposer, label: `V${b.proposer_index}`, kind: 'validator', href: `/validators/${b.proposer_index}`, detail: 'Observed block proposer in the 24-slot window', weight: 4 }); seen.add(proposer); }
      edges.push({ source: proposer, target: id, kind: 'proposed' });
      if (blocks.some(parent => parent.block_id === b.parent)) edges.push({ source: `b:${b.parent}`, target: id, kind: 'parent' });
    }
    return { nodes, edges, omitted: 0 };
  }, [cells]);
  const latest = points[points.length - 1];
  const valid = points.filter(p => p.connections !== null).length;
  const coverageChanges = points.filter((p, i) => i > 0 && p.reportingNodes !== null && points[i - 1].reportingNodes !== null && p.reportingNodes !== points[i - 1].reportingNodes).length;
  const labels = points.map(p => period === '7d' ? new Date(p.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) + ' ' + time(p.at) : time(p.at));
  const breaks = points.map((p, i) => i > 0 && p.reportingNodes !== points[i - 1].reportingNodes);
  const h = head.data?.head;
  const indexedTotal = BigInt(holders.data?.indexedTotalSat ?? '0');
  const topShare = (count: number) => indexedTotal > 0n ? Number((holders.data?.holders.slice(0, count).reduce((s, v) => s + BigInt(v.balanceSat), 0n) ?? 0n) * 10000n / indexedTotal) / 100 : null;
  const observedPrediction = points.map((_, i) => model?.predictions.find(p => p.index === i)?.model ?? null);
  const seriesOld = !!space.data && now - Date.parse(space.data.retrievedAt) > 180000;
  return <div className="atlas">
    <div className="atlas-masthead"><div><div className="atlas-eyebrow"><span className="atlas-cross">✳</span> BLOCH / NETWORK INTELLIGENCE <span className="atlas-version">GENESIS–4</span></div>
      <h1>One chain. <em>Every connection.</em></h1><p>Explore the structure of BLCH. Follow the records. Test the signals.</p></div>
      <div className="atlas-mast-actions"><a href="#graph-atlas" className="atlas-primary">Explore the graphs <span>↙</span></a><button type="button" onClick={() => setRefresh(v => v + 1)}>Refresh sources ↻</button></div></div>
    <div className="atlas-sourcebar"><div><Status name="Chain" reading={head} now={now} /><Status name="Indexer" reading={receipts} now={now} /><Status name="Space / shared source" reading={space} now={now} /></div><span>Read only · amounts in BLCH / sat · <a href="#atlas-sources">Source ledger ↗</a></span></div>
    <nav className="atlas-jumpnav" aria-label="Intelligence sections"><a href="#graph-atlas">01 / Graph atlas</a><a href="#signal-lab">02 / Signals & ML</a><a href="#atlas-records">03 / Source records</a><Link to="/chain">Chain dashboard ↗</Link><Link to="/graphus/constellation">Graphus ↗</Link><Link to="/system-map">System Map ↗</Link></nav>
    <div className="atlas-kpis">
      {[
        ['CHAIN HEIGHT', h ? fmtInt(h.height) : '—', h ? `Slot ${fmtInt(h.slot)} · ${head.error ? 'last reading' : stamp(head.at)}` : 'Awaiting archival head', '/blocks'],
        ['FINALIZED HEIGHT', h ? fmtInt(h.finalized_height) : '—', h ? `${h.epoch - h.finalized.epoch} epochs behind head` : 'Awaiting finality', '/finality'],
        ['ACTIVE VALIDATORS', h?.validators ? `${h.validators.active}` : '—', h?.validators ? `${h.validators.total} registered` : 'Awaiting registry', '/validators'],
        ['INDEXED REFERENCES', holders.data ? fmtInt(holders.data.total) : '—', holders.data ? `Funded scripts · slot ${fmtInt(holders.data.slot)}` : 'Awaiting balance snapshot', '/graphus/constellation#oculum-map'],
        ['MONITORED SOCKETS', latest?.connections != null ? fmtInt(latest.connections) : '—', latest ? `${latest.reportingNodes ?? '—'} reporters · ${stamp(latest.at)}` : 'Bloch Space series', '/network'],
        ['RECEIPT SAMPLE', receipts.data ? fmtInt(transactions.length) : '—', receipts.data ? `Latest indexed · through S${fmtInt(receipts.data.asOfSlot)}` : 'Awaiting indexed receipts', '/transactions'],
      ].map(([label, value, note, href]) => <a className="atlas-kpi" href={href} key={label}><span>{label}<b>↗</b></span><strong>{value}</strong><small>{note}</small></a>)}
    </div>

    <div id="graph-atlas" className="atlas-section-heading"><div><span className="atlas-eyebrow">01 / THE GRAPH ATLAS</span><h2>Structure, at every scale.</h2></div><label className="atlas-filter">Receipt type <select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All indexed types</option>{kinds.map(k => <option key={k}>{k}</option>)}</select></label></div>
    {(receipts.error || holders.error || head.error) && <p className="atlas-warning" role="status">{[receipts.error, holders.error, head.error].filter(Boolean).join(' ')} Available historical snapshots remain visible; check source times below.</p>}
    <div className="atlas-graph-grid">
      <Panel index="A / TRANSACTION TOPOLOGY" title="The eUTXO constellation" sub={`${filtered.length} sampled receipts · ${mode === 'outpoints' ? 'consumed and created outpoints' : 'transaction–script incidence'}`} className="atlas-main-graph"
        action={<div className="atlas-toggle">{(['outpoints', 'scripts'] as const).map(v => <button type="button" key={v} aria-pressed={mode === v} onClick={() => setMode(v)}>{v === 'outpoints' ? 'eUTXO' : 'Scripts'}</button>)}</div>}>
        <EvidenceGraph graph={graph} label="Bloch transaction and outpoint evidence graph" />
        <div className="atlas-key"><span><i style={{ background: palette[0] }} />Transactions</span><span><i style={{ background: mode === 'outpoints' ? palette[2] : palette[1] }} />{mode === 'outpoints' ? 'Outpoints' : 'Script references'}</span><span>Lines = receipt relationships</span></div>
      </Panel>
      <Panel index="B / SCRIPT INCIDENCE" title="Shared transaction structure" sub="Script references connected to the receipts in which they occur.">
        <EvidenceGraph graph={scriptGraph} radial label="Radial script and transaction incidence graph" />
        <p className="atlas-caption">Co-occurrence does not establish shared ownership or a direct payment path between scripts.</p>
      </Panel>
      <Panel index="C / CONSENSUS STRUCTURE" title="Proposers & block ancestry" sub="24 recent slots · links from observed proposer and parent fields.">
        <EvidenceGraph graph={blockGraph} label="Observed proposers and block parent graph" />
        <div className="atlas-key"><span><i style={{ background: palette[0] }} />Blocks</span><span><i style={{ background: palette[3] }} />Proposers</span><span>{cells.filter(c => c.kind === 'unknown').length} unread slots · {cells.filter(c => c.kind === 'empty').length} empty</span></div>
      </Panel>
      <Panel index="D / BALANCE CONSTELLATION" title="A field of holders" sub={holders.data ? `${holders.data.returned} of ${holders.data.total} funded script references · indexed eUTXOs` : 'Waiting for indexed balances'}>
        <div className="atlas-holder-field">{holders.data?.holders.length ? <svg viewBox="0 0 720 340" role="group" aria-label="Funded script balances, logarithmic bubble radii">
          {holders.data.holders.map((holder, i) => { const cols = 8, x = 49 + i % cols * 89, y = 42 + Math.floor(i / cols) * 41; const size = 5 + 11 * Math.log1p(Number(holder.balanceSat)) / Math.log1p(Number(holders.data!.holders[0].balanceSat)); return <a key={holder.scriptHash} href={`/graphus/constellation?script=${holder.scriptHash}`} aria-label={`Rank ${holder.rank}. ${fmtBloch(holder.balanceSat, 8)} BLCH. ${holder.utxoCount} UTXOs.`}>
            <title>#{holder.rank} · {fmtBloch(holder.balanceSat, 8)} BLCH · {holder.utxoCount} UTXOs</title><circle cx={x} cy={y} r={size + 4} fill={palette[i < 3 ? 0 : 2]} opacity=".1" /><circle cx={x} cy={y} r={size} fill={palette[i < 3 ? 0 : 2]} opacity={.35 + .6 * size / 16} /><text x={x} y={y + 3} textAnchor="middle">{holder.rank}</text></a>; })}
        </svg> : <div className="atlas-empty">{holders.data ? 'No funded script references in this snapshot.' : 'Loading indexed balances…'}</div>}</div>
        <div className="atlas-mini-stats"><div><span>Top reference</span><b>{topShare(1)?.toFixed(2) ?? '—'}%</b></div><div><span>Top 10 share</span><b>{topShare(10)?.toFixed(2) ?? '—'}%</b></div><div><span>Snapshot height</span><b>{holders.data ? fmtInt(holders.data.height) : '—'}</b></div></div>
        <p className="atlas-caption">Radius uses log balance. Shares use all indexed unspent value, excluding stake and delegation. Each point opens its record.</p>
      </Panel>
    </div>

    <div id="signal-lab" className="atlas-section-heading"><div><span className="atlas-eyebrow">02 / QUANTITATIVE SIGNAL LAB</span><h2>Observe. Model. Verify.</h2></div><div className="atlas-toggle" aria-label="Connection history window">{['6h', '24h', '7d'].map(p => <button type="button" key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p}</button>)}</div></div>
    {(space.error || seriesOld) && <p className="atlas-warning" role="status">{space.error ?? 'The upstream series is older than three minutes.'} {space.data ? `Showing source retrieved ${stamp(Date.parse(space.data.retrievedAt))}.` : ''}</p>}
    <div className="atlas-signal-grid">
      <Panel index="E / BLOCH SPACE · SHARED SOURCE" title="Connection history" sub={`${valid}/${points.length} observed buckets · ${coverageChanges} reporter-count changes`} action={<a href={`https://bloch.space/?network=bloch&view=analytics&range=${period}`} target="_blank" rel="noreferrer">Source ↗</a>}>
        <AtlasChart title="Monitored socket connections" labels={labels} breaks={breaks} series={[{ name: 'Reported sockets', values: points.map(p => p.connections), color: palette[0] }]} />
        <p className="atlas-caption">UTC · aggregate sockets, not unique peers. Lines break at gaps and reporter-count changes.</p>
      </Panel>
      <Panel index="F / SAMPLING COVERAGE" title="The observation matrix" sub="Each cell is a time bucket. Color follows the number of reporting nodes.">
        <div className="atlas-matrix">{points.length ? points.map((p, i) => <div key={p.at} tabIndex={0} className={p.reportingNodes === null ? 'is-missing' : ''} style={{ '--cell-alpha': p.reportingNodes === null ? 0 : .2 + .8 * p.reportingNodes / Math.max(1, ...points.map(v => v.reportingNodes ?? 0)) } as React.CSSProperties} title={`${labels[i]} UTC · ${p.reportingNodes ?? 'missing'} reporting nodes · ${p.connections ?? 'missing'} sockets`} aria-label={`${labels[i]} UTC: ${p.reportingNodes ?? 'missing'} reporters, ${p.connections ?? 'missing'} sockets`} />) : <div className="atlas-empty">Awaiting source history.</div>}</div>
        <div className="atlas-mini-stats"><div><span>Present buckets</span><b>{points.length ? `${(valid / points.length * 100).toFixed(1)}%` : '—'}</b></div><div><span>Coverage changes</span><b>{points.length ? coverageChanges : '—'}</b></div><div><span>Missing buckets</span><b>{points.length ? points.length - valid : '—'}</b></div></div>
        <p className="atlas-caption">Left to right, oldest to newest. Focus a cell to inspect its accessible time, reporter and socket counts.</p>
      </Panel>
      <Panel index="G / MACHINE LEARNING" title="A model that has to earn its place" sub="Ridge AR(3) · expanding-window evaluation · one step ahead" action={<span className="atlas-model-badge">{model ? 'EVALUATED' : 'INSUFFICIENT DATA'}</span>}>
        {model ? <><AtlasChart title="Observed connections and out-of-sample model predictions" labels={labels} breaks={breaks} series={[{ name: 'Observed', values: points.map(p => p.connections), color: palette[0] }, { name: 'Held-out prediction', values: observedPrediction, color: palette[1], dashed: true }]} />
          <div className="atlas-mini-stats"><div><span>Model MAE / sockets</span><b>{model.mae.toFixed(2)}</b></div><div><span>Persistence MAE</span><b>{model.baselineMae.toFixed(2)}</b></div><div><span>Skill vs baseline</span><b className={model.skill !== null && model.skill < 0 ? 'atlas-negative' : ''}>{model.skill === null ? 'undefined' : `${(model.skill * 100).toFixed(1)}%`}</b></div></div>
        </> : <div className="atlas-empty">At least 32 valid lag windows are required. Choose a longer range; missing data and coverage transitions are excluded.</div>}
        <details className="atlas-method"><summary>Method, evaluation and next-step estimate</summary><p>Three lagged connection counts, training-only standardization, ridge penalty λ=1. The first 24 valid windows train the initial model; each later point is predicted using only prior windows. A window is excluded if any of its four samples is missing or its reporter count changes. Training can combine separate valid windows. The baseline repeats the previous observation.</p><p>{model ? `${model.trainingRows} valid windows · ${model.predictions.length} held-out predictions. Next-step estimate: ${model.next === null ? 'unavailable' : model.next.toFixed(1)} sockets, conditional on unchanged reporting coverage. Negative skill means persistence performed better.` : 'No estimate is issued until the evaluation minimum is met.'} This is exploratory telemetry modeling, not a forecast of price, chain safety or finality.</p></details>
      </Panel>
      <Panel index="H / UNSUPERVISED LEARNING" title="Transaction shape clusters" sub="K-means · up to 3 groups · standardized log features">
        {clusters ? <div className="atlas-scatter"><svg viewBox="0 0 710 245" role="group" aria-label="Transaction structure clusters: inputs against output count">
          {[0, 1, 2, 3].map(i => <line key={i} x1="52" x2="674" y1={30 + i * 54} y2={30 + i * 54} stroke="var(--atlas-line)" strokeDasharray="3 5" />)}
          {filtered.map((tx, i) => { const x = 60 + Math.log1p(tx.inputs.length) / Math.max(1, ...filtered.map(t => Math.log1p(t.inputs.length))) * 595, y = 190 - Math.log1p(tx.outputs.length) / Math.max(1, ...filtered.map(t => Math.log1p(t.outputs.length))) * 148; return <a href={`/tx/${tx.txid}?block=${tx.blockId}`} key={`${tx.blockId}:${tx.txid}`} aria-label={`${short(tx.txid)} cluster ${clusters.labels[i] + 1}: ${tx.inputs.length} inputs, ${tx.outputs.length} outputs`}><title>{short(tx.txid)} · cluster {clusters.labels[i] + 1} · {tx.inputs.length} inputs / {tx.outputs.length} outputs</title><circle cx={x} cy={y} r="8" fill={palette[clusters.labels[i]]} opacity=".65" stroke="var(--atlas-panel)" strokeWidth="1" /></a>; })}
          <text x="52" y="224">0 inputs</text><text x="674" y="224" textAnchor="end">{Math.max(...filtered.map(tx => tx.inputs.length))} inputs → log(1+n)</text><text x="52" y="15">Outputs ↑ log(1+n) · coincident points overlap</text>
        </svg><div className="atlas-chart-legend">{clusters.centers.map((_, i) => <span key={i}><i style={{ background: palette[i] }} />Group {i + 1} / {clusters.labels.filter(c => c === i).length} receipts</span>)}</div></div> : <div className="atlas-empty">At least 8 receipts are required for clustering.</div>}
        <p className="atlas-caption">Features: input count, output count, total output satoshis (log-transformed). Deterministic initialization; at most 40 iterations. Groups describe this sample, not owners, risk or economic transfer volume.</p>
      </Panel>
      <Panel index="I / RESIDUAL DIAGNOSTICS" title="Where the model misses" sub="Held-out observed minus predicted sockets · signed residuals">
        <AtlasChart title="Out-of-sample prediction residuals" labels={labels} breaks={breaks} series={[{ name: 'Residual', values: points.map((_, i) => model?.predictions.find(p => p.index === i)?.residual ?? null), color: palette[3] }, { name: 'Zero', values: points.map(() => model ? 0 : null), color: 'var(--muted)', dashed: true }]} />
        <p className="atlas-caption">{model?.residualThreshold != null ? `Absolute residual p95: ${model.residualThreshold.toFixed(2)} sockets in this evaluation sample. ` : ''}Descriptive errors, not calibrated anomaly probabilities. Reporter transitions are excluded from evaluation.</p>
      </Panel>
      <Panel index="J / BALANCE DISTRIBUTION" title="Concentration, with a denominator" sub="Cumulative share of all indexed unspent satoshis">
        <div className="atlas-rank-bars">{[1, 3, 5, 10, 25, 64].map(n => <div key={n}><span>Top {n}</span><div><i style={{ width: `${topShare(n) ?? 0}%` }} /></div><b>{topShare(n)?.toFixed(2) ?? '—'}%</b></div>)}</div>
        <p className="atlas-caption">{holders.data ? `${holders.data.returned} displayed of ${holders.data.total} funded references; ranks beyond the available set use all available references. Exact indexed denominator: ${BigInt(holders.data.indexedTotalSat).toLocaleString('en-US')} sat.` : 'Waiting for a validated balance denominator.'} Script references are not people.</p>
      </Panel>
    </div>

    <div id="atlas-records" className="atlas-section-heading"><div><span className="atlas-eyebrow">03 / EVERY POINT HAS A RECORD</span><h2>Go from pattern to proof.</h2></div><button type="button" disabled={!receipts.data} onClick={() => exportFile('bloch-receipt-snapshot.json', JSON.stringify(receipts.data, null, 2), 'application/json')}>Export receipts ↓</button></div>
    <div className="atlas-records"><table><thead><tr><th>Transaction</th><th>Type</th><th>Slot</th><th>Inputs / outputs</th><th>Fee (sat)</th><th>Evidence</th></tr></thead><tbody>{filtered.slice(0, 8).map(tx => <tr key={`${tx.blockId}:${tx.txid}`}><td><a href={`/tx/${tx.txid}?block=${tx.blockId}`}>{short(tx.txid)}</a></td><td>{tx.kind}</td><td>{fmtInt(tx.slot)}</td><td>{tx.inputs.length} / {tx.outputs.length}</td><td>{tx.feeSat === null ? 'unavailable' : BigInt(tx.feeSat).toLocaleString('en-US')}</td><td><a href={`/tx/${tx.txid}?block=${tx.blockId}`}>Receipt ↗</a></td></tr>)}{!filtered.length && <tr><td colSpan={6}>No receipts available for this filter.</td></tr>}</tbody></table></div>
    <section id="atlas-sources" className="atlas-source-ledger"><div><span className="atlas-eyebrow">PROVENANCE / NO HIDDEN DENOMINATORS</span><h2>Open the source.</h2><p>Different sources can observe different heads. The graphs describe their named windows, not the whole network.</p>{head.data && <CorroborationBadge c={head.data.corroboration} />}</div><div className="atlas-source-list">
      <article><span>01</span><div><a href="/chain">Bloch archival edge ↗</a><p>Head and 24-slot proposer window · {stamp(head.at)}{head.at && now - head.at > 150000 ? ' · stale snapshot' : ''}</p></div></article>
      <article><span>02</span><div><a href="/indexer/transactions?limit=48">Canonical historical indexer ↗</a><p>{receipts.data?.source ?? 'Waiting for receipt source'} · {stamp(receipts.at)}. {receipts.data?.truncated ? 'Bounded recent sample; earlier receipts exist.' : 'No earlier-page claim is made.'}</p></div></article>
      <article><span>03</span><div><a href={`https://bloch.space/api/series?network=bloch&range=${period}`} target="_blank" rel="noreferrer">Bloch Space / shared series ↗</a><p>{space.data?.source ?? 'Monitored-node observability'} · retrieved {space.data ? stamp(Date.parse(space.data.retrievedAt)) : '—'}. Read directly from the same telemetry producer used by Bloch Space; not independent corroboration.</p></div></article>
      <article><span>04</span><div><Link to="/system-map">Graphus System Map / integrated APIs →</Link><p>Explore modules and capture bounded BTC, Ethereum and Bloch samples. Exact records, source anchors and exports open inside the explorer.</p></div></article>
      <article><span>05</span><div><a href="/indexer/holders?limit=64">Indexed holder snapshot ↗</a><p>Loaded {stamp(holders.at)} · {holders.data ? `H${fmtInt(holders.data.height)} / S${fmtInt(holders.data.slot)}` : 'awaiting source'}. Snapshot can differ from the receipt window.</p></div></article>
    </div><div className="atlas-export-row"><button type="button" disabled={!space.data} onClick={() => exportFile(`bloch-connections-${period}.csv`, 'time_utc,connections,reporting_nodes\n' + points.map(p => `${new Date(p.at).toISOString()},${p.connections ?? ''},${p.reportingNodes ?? ''}`).join('\n') + '\n', 'text/csv')}>Export observations CSV ↓</button><button type="button" disabled={!model} onClick={() => exportFile(`bloch-model-evaluation-${period}.json`, JSON.stringify({ method: 'ridge AR(3), lambda=1, expanding window, min train=24', source: space.data, result: model }, null, 2), 'application/json')}>Export model evaluation ↓</button></div></section>
  </div>;
}
