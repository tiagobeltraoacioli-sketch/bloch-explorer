// SPDX-License-Identifier: AGPL-3.0-or-later
// Historical receipts are replayed from the archival log with state-root
// verification. Monetary amounts remain decimal strings. Snapshot cursors
// survive appends and return 409 when their anchor is reorganized.
/** Where the indexer lives, if it lives anywhere. */
export const INDEXER_BASE: string =
  (import.meta as { env?: Record<string, string> }).env?.VITE_BLOCH_INDEXER ?? "/indexer";

export interface IndexerHealth {
  ok: boolean;
  indexed_to_slot: number;
  indexed_to_height: number;
  finalized_height: number;
  source: string;
  lag_slots: number | null;
  live_head_available?: boolean;
}

export interface IndexedUtxo {
  txid: string;
  vout: number;
  value_sat: string;
  created_slot: number;
  created_height: number;
}

export interface IndexedUtxoPage {
  script_hash: string;
  total: number;
  utxos: IndexedUtxo[];
  next_cursor: string | null;
  as_of_slot: number;
}

export interface IndexedOutpoint {
  txid: string;
  vout: number;
  value_sat: string;
  script_hash: string;
  created_slot: number;
  created_height: number;
  spent_slot: number | null;
  spent_height: number | null;
  as_of_slot: number;
}

export interface IndexedEvent {
  kind: "created" | "spent";
  transaction_id?: string;
  block_id?: string;
  txid: string;
  vout: number;
  value_sat: string;
  slot: number;
  height: number;
}

export interface IndexedHistoryPage {
  script_hash: string;
  events: IndexedEvent[];
  next_cursor: string | null;
  as_of_slot: number;
}

/** One side of a transaction. Inputs name the outpoint they spend; outputs do not have a txid of their own. */
export interface IndexedTxIo {
  txid?: string;
  vout: number;
  value_sat: string;
  script_hash: string;
}

export interface IndexedTx {
  txid: string;
  block_id: string;
  slot: number;
  height: number;
  /** Position in the block body, 0-based. */
  index: number;
  /** The node's own variant word. */
  kind: string;
  inputs: IndexedTxIo[];
  outputs: IndexedTxIo[];
  fee_sat: string | null;
  stake_sat?: string;
  chain_tip?: string;
  as_of_slot?: number;
  size_bytes: number;
}

export interface IndexedTxPage {
  transactions: IndexedTx[];
  next_cursor: string | null;
  as_of_slot: number;
}

export interface IndexedBlockTxs {
  block_id: string;
  slot: number;
  height: number | null;
  tx_count: number;
  transactions: IndexedTx[];
  as_of_slot: number;
}

const TIMEOUT_MS = 8000;

async function get<T>(path: string): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(INDEXER_BASE + path, { signal: ac.signal });
    if (!res.ok) throw new Error(res.status === 409 ? "The indexed snapshot changed. Restart this history to read the current chain." : `Indexer unavailable (${res.status}). Please retry.`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is there an indexer at all?
 *
 * Probed once per page load and cached, including the negative. A page that
 * re-probes a missing service on every render turns "the indexer is not
 * deployed yet" into a stream of failed requests, and the console noise is
 * how a real outage gets missed later.
 */
let probe: Promise<IndexerHealth | null> | null = null;
let probedAt = 0;

export function indexerHealth(): Promise<IndexerHealth | null> {
  if (!probe || Date.now() - probedAt > 15_000) {
    probedAt = Date.now();
    probe = get<IndexerHealth>("/health")
      .then((h) => (h && h.ok ? h : null))
      .catch(() => null);
  }
  return probe;
}

export function indexedUtxos(
  scriptHash: string,
  cursor?: string | null,
  limit = 100,
): Promise<IndexedUtxoPage> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return get<IndexedUtxoPage>(`/utxos/${scriptHash}?${q}`);
}

export function indexedOutpoint(txid: string, vout: number): Promise<IndexedOutpoint> {
  return get<IndexedOutpoint>(`/outpoint/${txid}/${vout}`);
}

export function indexedHistory(
  scriptHash: string,
  cursor?: string | null,
  limit = 50,
): Promise<IndexedHistoryPage> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return get<IndexedHistoryPage>(`/history/${scriptHash}?${q}`);
}

export function indexedTransactions(cursor?: string | null, limit = 25): Promise<IndexedTxPage> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return get<IndexedTxPage>(`/transactions?${q}`);
}

export function indexedBlockTransactions(blockId: string): Promise<IndexedBlockTxs> {
  return get<IndexedBlockTxs>(`/block/${blockId}/transactions`);
}

/**
 * One transaction by its consensus id, or null when the indexer does not have
 * it. A 404 is the ANSWER here, not a fault: it is what a node-local
 * `tx_hash` pasted from a wallet produces, and the page has a whole
 * explanation ready for exactly that case.
 */
export class IndexedTxAmbiguity extends Error {
  constructor(public matches: IndexedTx[]) { super("This transaction ID appears more than once. Choose its block."); }
}

export async function indexedTransaction(txid: string): Promise<IndexedTx | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${INDEXER_BASE}/tx/${txid}`, { signal: ac.signal });
    if (res.status === 404) return null;
    if (res.status === 409) {
      const body = await res.json();
      if (Array.isArray(body.matches)) throw new IndexedTxAmbiguity(body.matches);
    }
    if (!res.ok) throw new Error(res.status === 409 ? "The indexed snapshot changed. Restart this history to read the current chain." : `Indexer unavailable (${res.status}). Please retry.`);
    return (await res.json()) as IndexedTx;
  } finally {
    clearTimeout(timer);
  }
}

/** Sum a side of a transaction, exactly. Unparseable amounts are refused, never zeroed. */
export function sumSide(side: IndexedTxIo[]): bigint | null {
  let t = 0n;
  for (const io of side) {
    if (typeof io.value_sat !== "string" || !/^[0-9]+$/.test(io.value_sat)) return null;
    t += BigInt(io.value_sat);
  }
  return t;
}
