// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The indexer client — and, until the indexer exists, the written contract for
// what it must serve.
//
// ── Why there has to be one ─────────────────────────────────────────────────
//
// Two things the node RPC cannot do, measured against the live chain on
// 2026-09-01 from the archival at 139.180.166.5:8080:
//
//   1. PAGING. `getutxos` takes `(script_hash, limit)` and nothing else. No
//      cursor, no offset. `UTXO_PAGE_DEFAULT` is 100, `UTXO_PAGE_MAX` is 1,000
//      and the clamp is server-side (asking for 5,000 returns 1,000 with
//      `truncated: true`). The founder's carried hash
//      `e986db51…af4ff‖0×12` held 45,149 unspent outputs at slot 54,535, so
//      44,149 of them are unreachable: the same first thousand come back every
//      time. At genesis that same hash held 426,194 of the chain's 452,726
//      carryover outputs.
//
//   2. HISTORY. Nothing is indexed by transaction id here. `gettransaction`
//      refuses BY DESIGN, in those words ("this is a permanent answer for this
//      build, not a transient failure — do not retry"), because
//      `PosTransaction::Transfer` encodes only fee-market terms and the block
//      store keeps no txid index. Nothing maps a script hash to the blocks
//      that touched it, and `getblockbyslot` reports `tx_count` — a number —
//      not the transactions themselves.
//
// Everything in this file is therefore OPTIONAL by construction. The address
// page must render, completely and honestly, with `available === false`; the
// indexer only ever ADDS rows. That is not politeness, it is the failure mode
// we are designing against: a page that silently shows a partial set as if it
// were the whole one is the same bug as a silent zero balance.
//
// ── The contract (for the sibling task building it) ─────────────────────────
//
// Base URL from `VITE_BLOCH_INDEXER` at build time, else same-origin
// `/indexer`. All responses JSON, all satoshi amounts DECIMAL STRINGS (supply
// is 1e19 sat, ~1110× Number.MAX_SAFE_INTEGER — a satoshi value that passes
// through a JS number is silently rounded). All hashes lowercase hex, no `0x`.
//
//   GET /indexer/health
//     -> { ok, indexed_to_slot, indexed_to_height, finalized_height,
//          source: "139.180.166.5:8080" | …, lag_slots }
//     `indexed_to_slot` is load-bearing: every other answer is AS OF that
//     slot, and the page prints it. An indexer that does not say how far
//     behind it is cannot be trusted to say anything else.
//
//   GET /indexer/utxos/:script_hash?cursor=&limit=
//     -> { script_hash, total, utxos: [{ txid, vout, value_sat,
//                                        created_slot, created_height }],
//          next_cursor: string | null, as_of_slot }
//     THE reason the indexer exists. `created_slot` is the second reason:
//     `getutxos` does not carry it and `gettxout`'s `at_slot` is NOT it (see
//     below), so the slot an output landed in exists nowhere on the RPC.
//     Opaque cursor, please — offset-into-a-changing-set is a paging bug
//     waiting to duplicate and skip rows under reorg.
//
//   GET /indexer/outpoint/:txid/:vout
//     -> { txid, vout, value_sat, script_hash,
//          created_slot, created_height,
//          spent_slot: number | null, spent_height: number | null,
//          as_of_slot }
//     The honest unit of history on this chain. Not a transaction: an
//     outpoint, the slot that created it, and the slot that spent it.
//
//   GET /indexer/history/:script_hash?cursor=&limit=
//     -> { script_hash, events: [{ kind: "created" | "spent", txid, vout,
//                                  value_sat, slot, height }],
//          next_cursor: string | null, as_of_slot }
//     "Transaction history", as far as this chain permits one. An event is an
//     outpoint appearing or disappearing under this hash — never a "payment",
//     because nothing on the wire says who paid whom.
//
//   GET /indexer/transactions?cursor=&limit=
//     -> { transactions: [Tx], next_cursor: string | null, as_of_slot }
//     Newest first. THE list every explorer reader arrives expecting, and the
//     one thing the node cannot give: `getblockbyslot` carries `tx_count`, a
//     number, and no body. An indexer can only serve this if it sees block
//     BODIES — as an observer node reading its own store, or through a body
//     method the RPC does not have today — which is already what
//     `created_slot` above presumes. Nothing here is derivable from the
//     public RPC alone, and the pages say so when this answers 404.
//
//   GET /indexer/block/:block_id/transactions
//     -> { block_id, slot, height, tx_count, transactions: [Tx], as_of_slot }
//     `tx_count` MUST equal the header's `tx_count`; a page compares them and
//     labels a mismatch rather than trusting either.
//
//   GET /indexer/tx/:txid
//     -> Tx, or 404 when the id is not one the indexer folded. 404, not an
//     empty body: "not indexed" and "no such transaction" are different
//     statements and the id the wallet hands a user (a node-local `tx_hash`)
//     is very often the former.
//
//   Tx = { txid, block_id, slot, height, index, kind,
//          inputs:  [{ txid, vout, value_sat, script_hash }],
//          outputs: [{ vout, value_sat, script_hash }],
//          fee_sat, size_bytes }
//     `txid` is consensus's `SHA3-256(DS_TXID ‖ spend_signing_root)` — the
//     witness-free id, NOT the node-local `tx_hash` `sendrawtransaction`
//     returns. `kind` is the node's own word for the variant ("transfer",
//     "transfer_v2", "deposit", "exit", …), never a word of ours. `fee_sat`
//     is `sum(inputs) − sum(outputs)`, which consensus checks with `!=`.
//
// The indexer MUST read from the archivals (139.180.166.5 / 139.180.173.231,
// port 8080) and never from a validator: that RPC has no auth, no rate limit,
// and is served by the consensus thread itself (`EngineBackend` hands each
// call to the engine's event loop — a burst of reads competes with block
// production).

/** Where the indexer lives, if it lives anywhere. */
export const INDEXER_BASE: string =
  (import.meta as { env?: Record<string, string> }).env?.VITE_BLOCH_INDEXER ?? "/indexer";

export interface IndexerHealth {
  ok: boolean;
  indexed_to_slot: number;
  indexed_to_height: number;
  finalized_height: number;
  source: string;
  lag_slots: number;
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
  fee_sat: string;
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
    if (!res.ok) throw new Error(`indexer ${res.status}`);
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

export function indexerHealth(): Promise<IndexerHealth | null> {
  if (!probe) {
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
export async function indexedTransaction(txid: string): Promise<IndexedTx | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${INDEXER_BASE}/tx/${txid}`, { signal: ac.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`indexer ${res.status}`);
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
