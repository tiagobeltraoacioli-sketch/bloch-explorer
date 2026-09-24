// SPDX-License-Identifier: AGPL-3.0-or-later
import { graphusTransaction, type GraphusTransaction } from './graphus.ts';

export interface SeriesPoint { at: number; connections: number | null; reportingNodes: number | null }
export interface SpaceSeries { period: string; source: string; retrievedAt: string; points: SeriesPoint[] }
export function parseSpaceSeries(value: unknown, period: string): SpaceSeries | null {
  const d = value as Record<string, unknown> | null;
  const step = ({ '6h': 300000, '24h': 900000, '7d': 3600000 } as Record<string, number>)[period];
  if (!d || !step || d.network !== 'bloch' || d.period !== period || typeof d.source !== 'string' ||
      typeof d.retrieved_at !== 'string' || !Number.isFinite(Date.parse(d.retrieved_at)) ||
      !Array.isArray(d.points) || d.points.length < 2 || d.points.length > 169) return null;
  const points: SeriesPoint[] = [];
  for (const p of d.points) {
    if (!p || !Number.isSafeInteger(p.at) || p.at <= 0 || (points.length && p.at - points[points.length - 1].at !== step)) return null;
    const missing = p.connections === null && p.reporting_nodes === null;
    if (!missing && (!Number.isSafeInteger(p.connections) || p.connections < 0 || !Number.isSafeInteger(p.reporting_nodes) || p.reporting_nodes < 1)) return null;
    points.push({ at: p.at, connections: p.connections, reportingNodes: p.reporting_nodes });
  }
  return { period, source: d.source, retrievedAt: d.retrieved_at, points };
}

export interface ReceiptSample { transactions: GraphusTransaction[]; asOfSlot: number; source: string; truncated: boolean }
export function parseReceiptSample(value: unknown): ReceiptSample | null {
  const d = value as Record<string, unknown> | null;
  if (!d || !Array.isArray(d.transactions) || d.transactions.length > 64 || !Number.isSafeInteger(d.as_of_slot) || Number(d.as_of_slot) < 0 || typeof d.source !== 'string') return null;
  const transactions = d.transactions.map(graphusTransaction);
  if (transactions.some(tx => !tx)) return null;
  // A transaction ID can recur in distinct blocks; keep the receipt identity.
  if (new Set(transactions.map(tx => `${tx!.blockId}:${tx!.txid}`)).size !== transactions.length) return null;
  return { transactions: transactions as GraphusTransaction[], asOfSlot: Number(d.as_of_slot), source: d.source, truncated: !!d.next_cursor };
}

export interface GraphNode { id: string; label: string; kind: 'transaction' | 'script' | 'outpoint' | 'block' | 'validator' | 'address'; href: string; detail: string; weight: number }
export interface GraphEdge { source: string; target: string; kind: string }
export interface EvidenceGraph { nodes: GraphNode[]; edges: GraphEdge[]; omitted: number }
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-4)}`;
export function receiptGraph(transactions: GraphusTransaction[], mode: 'outpoints' | 'scripts'): EvidenceGraph {
  const nodes = new Map<string, GraphNode>(), edges: GraphEdge[] = []; let omitted = 0;
  const edgeKeys = new Set<string>();
  for (const tx of transactions.slice(0, 48)) {
    const id = `tx:${tx.blockId}:${tx.txid}`;
    if (nodes.size >= 650) { omitted += tx.inputs.length + tx.outputs.length; continue; }
    nodes.set(id, { id, label: short(tx.txid), kind: 'transaction', href: `/tx/${tx.txid}?block=${tx.blockId}`, detail: `${tx.kind} · slot ${tx.slot} · ${tx.inputs.length} inputs / ${tx.outputs.length} outputs`, weight: 3 });
    for (const [side, ios] of [['consumes', tx.inputs], ['creates', tx.outputs]] as const) {
      // At most 16 IO records per side; the full receipt is always linked.
      const entries = mode === 'scripts' ? ios : ios.slice(0, 16);
      omitted += ios.length - entries.length;
      for (const io of entries) {
        if (mode === 'outpoints' && !io.txid) { omitted++; continue; }
        const target = mode === 'scripts' ? `s:${io.scriptHash}` : `o:${io.txid}:${io.vout}`;
        const prior = nodes.get(target);
        if ((!prior && nodes.size >= 650) || edges.length >= 1600) { omitted++; continue; }
        nodes.set(target, prior ? { ...prior, weight: prior.weight + 1 } : {
          id: target, label: mode === 'scripts' ? short(io.scriptHash) : `${short(io.txid!)}:${io.vout}`,
          kind: mode === 'scripts' ? 'script' : 'outpoint', weight: 1,
          href: mode === 'scripts' ? `/graphus/constellation?script=${io.scriptHash}` : `/outpoint/${io.txid}/${io.vout}`,
          detail: mode === 'scripts' ? io.scriptHash : `${BigInt(io.valueSat).toLocaleString('en-US')} sat · ${short(io.scriptHash)}`,
        });
        // Parallel records of one script/side are one evidence edge.
        const from = side === 'consumes' ? target : id, to = side === 'consumes' ? id : target;
        const key = `${from}/${to}/${side}`;
        if (!edgeKeys.has(key)) { edges.push({ source: from, target: to, kind: side }); edgeKeys.add(key); }
      }
    }
  }
  return { nodes: [...nodes.values()], edges, omitted };
}

export interface ClusterResult { labels: number[]; centers: number[][]; iterations: number }
/** Deterministic k-means over standardized log IO counts and output amounts.
 * The clusters describe receipt shape; they are not ownership or risk labels. */
export function clusterReceipts(txs: GraphusTransaction[]): ClusterResult | null {
  if (txs.length < 8) return null;
  const raw = txs.map(tx => [Math.log1p(tx.inputs.length), Math.log1p(tx.outputs.length), Math.log1p(Number(tx.outputs.reduce((sum, io) => sum + BigInt(io.valueSat), 0n)))]);
  const means = raw[0].map((_, j) => raw.reduce((s, row) => s + row[j], 0) / raw.length);
  const scales = means.map((mean, j) => Math.sqrt(raw.reduce((s, row) => s + (row[j] - mean) ** 2, 0) / raw.length) || 1);
  const rows = raw.map(row => row.map((v, j) => (v - means[j]) / scales[j]));
  const dist = (a: number[], b: number[]) => a.reduce((s, v, j) => s + (v - b[j]) ** 2, 0);
  const centers = [rows[0].slice()];
  while (centers.length < 3) {
    const next = rows.reduce((best, row) => Math.min(...centers.map(c => dist(row, c))) > Math.min(...centers.map(c => dist(best, c))) ? row : best, rows[0]);
    if (Math.min(...centers.map(c => dist(next, c))) < 1e-10) break;
    centers.push(next.slice());
  }
  let labels = rows.map(() => -1), iterations = 0;
  for (; iterations < 40; iterations++) {
    const next = rows.map(row => centers.map(c => dist(row, c)).reduce((best, d, j, ds) => d < ds[best] ? j : best, 0));
    if (next.every((v, i) => v === labels[i])) break;
    labels = next;
    centers.forEach((center, k) => { const members = rows.filter((_, i) => labels[i] === k); if (members.length) center.forEach((_, j) => center[j] = members.reduce((s, row) => s + row[j], 0) / members.length); });
  }
  return { labels, centers, iterations };
}

interface LagRow { index: number; x: number[]; y: number }
export interface ModelResult { predictions: { index: number; observed: number; model: number; baseline: number; residual: number }[]; mae: number; baselineMae: number; skill: number | null; next: number | null; trainingRows: number; residualThreshold: number | null }
function solve(matrix: number[][], vector: number[]): number[] {
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < a.length; col++) {
    let pivot = col; for (let i = col + 1; i < a.length; i++) if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col]; if (Math.abs(divisor) < 1e-12) return vector.map(() => 0);
    for (let j = col; j <= a.length; j++) a[col][j] /= divisor;
    for (let i = 0; i < a.length; i++) if (i !== col) { const f = a[i][col]; for (let j = col; j <= a.length; j++) a[i][j] -= f * a[col][j]; }
  }
  return a.map(row => row[a.length]);
}
function predict(rows: LagRow[], input: number[]): number {
  const mean = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  const scale = Math.sqrt(rows.reduce((s, r) => s + (r.y - mean) ** 2, 0) / rows.length) || 1;
  const a = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => i === j && i > 0 ? 1 : 0));
  const b = [0, 0, 0, 0];
  for (const row of rows) { const x = [1, ...row.x.map(v => (v - mean) / scale)], y = (row.y - mean) / scale; x.forEach((v, i) => { b[i] += v * y; x.forEach((w, j) => a[i][j] += v * w); }); }
  const beta = solve(a, b), x = [1, ...input.map(v => (v - mean) / scale)];
  return Math.max(0, mean + scale * beta.reduce((sum, v, i) => sum + v * x[i], 0));
}
/** Expanding-window ridge AR(3), lambda=1. Each prediction sees only its past.
 * Four-point windows crossing a gap or reporter-count change are excluded. */
export function evaluateSeries(points: SeriesPoint[]): ModelResult | null {
  const rows: LagRow[] = [];
  for (let i = 3; i < points.length; i++) {
    const window = points.slice(i - 3, i + 1), coverage = window[0].reportingNodes;
    if (coverage === null || window.some(p => p.connections === null || p.reportingNodes !== coverage)) continue;
    rows.push({ index: i, x: window.slice(0, 3).map(p => p.connections!), y: window[3].connections! });
  }
  if (rows.length < 32) return null;
  const predictions = rows.slice(24).map((row, j) => { const model = predict(rows.slice(0, j + 24), row.x); return { index: row.index, observed: row.y, model, baseline: row.x[2], residual: row.y - model }; });
  const mae = predictions.reduce((s, p) => s + Math.abs(p.residual), 0) / predictions.length;
  const baselineMae = predictions.reduce((s, p) => s + Math.abs(p.observed - p.baseline), 0) / predictions.length;
  const tail = points.slice(-3);
  const next = tail.length === 3 && tail[0].reportingNodes !== null && tail.every(p => p.connections !== null && p.reportingNodes === tail[0].reportingNodes) ? predict(rows, tail.map(p => p.connections!)) : null;
  const errors = predictions.map(p => Math.abs(p.residual)).sort((a, b) => a - b);
  return { predictions, mae, baselineMae, skill: baselineMae > 1e-9 ? 1 - mae / baselineMae : null, next, trainingRows: rows.length,
    residualThreshold: errors.length >= 20 ? errors[Math.min(errors.length - 1, Math.ceil(errors.length * .95) - 1)] : null };
}
