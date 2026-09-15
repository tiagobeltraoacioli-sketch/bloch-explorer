// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Transactions — the page every explorer has, on a chain that does not index them.
//
// Two tiers of truth, kept apart on the page as they are in the data:
//
//   WHAT THE CHAIN SAYS. A block header carries `tx_count`. So the RPC can tell
//   you WHERE transactions landed — which slots, how many, proposed by whom —
//   and, for any outpoint you already hold, whether it is unspent right now.
//   That is the whole of it: there is no transaction list, no txid index, and
//   `gettransaction` is a permanent refusal. The landing feed below is folded
//   from the same edge-cached slot reads the analytics page uses.
//
//   WHAT AN INDEXER ADDS. When one is attached (`lib/indexer.ts`, probed once
//   per page load) the transactions themselves appear: id, inputs, outputs,
//   fee, kind. Every indexed figure carries the indexer's as-of slot beside
//   it, and the page renders completely and honestly without it.
//
// The two are never blended. A reader must always be able to tell which of the
// two answered — a list that was half chain and half index would inherit the
// weaker guarantee and show the stronger label.
import { useEffect, useMemo, useRef, useState } from "react";
import { g4rpc, G4Head } from "../lib/g4";
import { EpochSummary, loadEpoch, epochSlots } from "../lib/epochs";
import { SlotCell } from "../lib/slots";
import {
  indexerHealth,
  indexedTransactions,
  IndexerHealth,
  IndexedTx,
} from "../lib/indexer";
import { TxStatusLookup } from "../components/telemetry";
import { Kpi } from "../components/kit";
import { TxRows, TxLandings, OutpointCheck } from "../components/txBits";
import { Loading } from "../components/ui";
import { Link } from "../lib/router";
import { fmtInt, fmtNum, timeAgo } from "../lib/format";
import { PARAMS } from "../lib/g4params";
import "../dashboard.css";

/** Epochs scanned per request for the landing feed. */
const BATCH = 6;
/** The most the page will hold. Beyond this is the indexer's job. */
const MAX_EPOCHS = 30;
/** Indexed rows per page. */
const PAGE = 25;

export function TransactionsPage() {
  const [head, setHead] = useState<G4Head | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState<IndexerHealth | null | undefined>(undefined);
  const [txs, setTxs] = useState<IndexedTx[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [idxErr, setIdxErr] = useState<string | null>(null);
  const [idxBusy, setIdxBusy] = useState(false);
  const [epochs, setEpochs] = useState<Map<number, EpochSummary>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const ac = useRef<AbortController | null>(null);

  useEffect(() => {
    let stop = false;
    ac.current = new AbortController();
    (async () => {
      const health = await indexerHealth();
      if (stop) return;
      setIdx(health);
      if (health) {
        await loadIndexed(null);
        return;
      }
      try {
        const h = await g4rpc<G4Head>("getchaininfo", [], { signal: ac.current!.signal });
        if (stop) return;
        setHead(h);
        await loadBatch(h, h.epoch, BATCH);
      } catch (e: any) {
        if (!stop && e?.name !== "AbortError") setErr(String(e?.message ?? e));
      }
    })();
    return () => {
      stop = true;
      ac.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadIndexed(c: string | null) {
    setIdxBusy(true);
    try {
      const page = await indexedTransactions(c, PAGE);
      setTxs((prev) => (c ? [...prev, ...page.transactions] : page.transactions));
      setCursor(page.next_cursor);
      setAsOf(page.as_of_slot);
      setIdxErr(null);
    } catch (e: any) {
      setIdxErr(String(e?.message ?? e));
    } finally {
      setIdxBusy(false);
    }
  }

  async function loadBatch(h: G4Head, from: number, n: number) {
    setBusy(true);
    try {
      for (let e = from; e > from - n && e >= 0; e--) {
        if (ac.current?.signal.aborted) return;
        const put = (s: EpochSummary) =>
          setEpochs((prev) => {
            const next = new Map(prev);
            next.set(s.epoch, s);
            return next;
          });
        const s = await loadEpoch(e, h.slot, { signal: ac.current?.signal, onProgress: put });
        put(s);
      }
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => [...epochs.values()].sort((a, b) => b.epoch - a.epoch), [epochs]);
  const cells = useMemo<SlotCell[]>(() => rows.flatMap((r) => r.cells), [rows]);
  const scan = useMemo(() => {
    let blocks = 0, withTx = 0, txsTotal = 0, unread = 0;
    let last: Extract<SlotCell, { kind: "block" }> | null = null;
    for (const c of cells) {
      if (c.kind === "unknown") unread++;
      if (c.kind !== "block") continue;
      blocks++;
      if (c.block.tx_count > 0) {
        withTx++;
        txsTotal += c.block.tx_count;
        if (!last || c.slot > last.slot) last = c;
      }
    }
    return { blocks, withTx, txsTotal, unread, last };
  }, [cells]);

  if (err && !head && !idx) {
    return (
      <div className="container">
        <h1 className="page-title">Transactions</h1>
        <TxStatusLookup />
        <div className="errbox">The Genesis-4 endpoint did not answer ({err}). That reports the proxy, not the network.</div>
      </div>
    );
  }
  if (idx === undefined) return <Loading label="Checking historical index…" />;
  if (!head && !idx) return <Loading label="Reading the head…" />;

  const oldest = rows.length ? rows[rows.length - 1].epoch : null;
  const lowSlot = oldest === null ? (head?.slot ?? idx?.indexed_to_slot ?? 0) : epochSlots(oldest)[0];
  const slotsScanned = (head?.slot ?? lowSlot) - lowSlot + 1;
  const canLoad = oldest !== null && oldest > 0 && rows.length < MAX_EPOCHS && !busy;

  return (
    <div className="container">
      <h1 className="page-title">
        Transactions{" "}
        {idx === undefined ? null : idx ? (
          <span className="pill brass" title={`An indexer is attached, indexed to slot ${fmtInt(idx.indexed_to_slot)} (${idx.lag_slots === null ? "live freshness unavailable" : `${fmtInt(idx.lag_slots)} slots behind the observed head`}).`}>
            indexed to slot {fmtInt(idx.indexed_to_slot)}
          </span>
        ) : (
          <span className="pill quiet" title="No indexer is attached. This page shows what the chain itself can say.">
            chain only
          </span>
        )}
      </h1>
      <TxStatusLookup />
      <p className="page-lede">
        {idx
          ? "Each receipt lists its recorded inputs, outputs and fee. Pages share the displayed historical snapshot, so new blocks do not shift older results."
          : "The historical index is unavailable. The block-header view below shows where transaction-bearing blocks were observed."}
      </p>

      {/* ── the indexed feed, when there is one ──────────────────────────── */}
      {idx && (
        <section className="card">
          <div className="card-head">
            <h2 className="snap-h2" style={{ margin: 0 }}>Latest transactions</h2>
            <span className="pill brass pill-sm">indexer</span>
            {idx.lag_slots === null && <span className="pill quiet pill-sm">live freshness unavailable</span>}
            {idx.lag_slots !== null && idx.lag_slots > 2 && <span className="pill warn pill-sm">{fmtInt(idx.lag_slots)} slots behind the head</span>}
            <span className="spacer" />
            <span className="faint" style={{ fontSize: 12 }}>{fmtInt(txs.length)} shown</span>
          </div>
          {idxErr && <div className="errbox">The indexer did not answer: {idxErr}</div>}
          {txs.length === 0 && !idxBusy && !idxErr ? (
            <p className="lookup-hint">The indexer has folded no transactions yet.</p>
          ) : asOf !== null ? (
            <TxRows txs={txs} asOfSlot={asOf} />
          ) : (
            <Loading label="Asking the indexer…" />
          )}
          {cursor && (
            <div className="actions">
              <button className="btn btn-sm" disabled={idxBusy} onClick={() => void loadIndexed(cursor)}>
                {idxBusy ? "reading…" : `${PAGE} older`}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Header scanning is a fallback, never parallel load on the indexed view. */}
      {!idx && head && <section className="card">
        <div className="card-head">
          <h2 className="snap-h2" style={{ margin: 0 }}>Where transactions landed — the last {fmtInt(slotsScanned)} slots</h2>
          <span className="pill quiet pill-sm">from block headers</span>
          {busy && <span className="pill quiet pill-sm"><span className="dot live" /> reading</span>}
          <span className="spacer" />
          <Link to="/analytics" className="pill-tab">analytics →</Link>
        </div>
        <div className="kpi-grid" style={{ marginBottom: 14 }}>
          <Kpi k="Transactions" v={fmtInt(scan.txsTotal)} tone={scan.txsTotal > 0 ? "accent" : undefined} sub={`across ${fmtInt(slotsScanned)} slots · ${fmtInt(rows.length)} epochs`} />
          <Kpi k="Blocks carrying them" v={fmtInt(scan.withTx)} sub={`of ${fmtInt(scan.blocks)} blocks read${scan.unread ? ` · ${fmtInt(scan.unread)} slots unread` : ""}`} />
          <Kpi k="Per carrying block" v={scan.withTx ? fmtNum(scan.txsTotal / scan.withTx, 2) : "—"} sub="mean, where any landed" />
          <Kpi
            k="Last transaction"
            v={scan.last ? timeAgo(scan.last.block.timestamp) : "none in window"}
            sub={scan.last ? `slot ${fmtInt(scan.last.slot)} · height ${scan.last.block.height === null ? "—" : fmtInt(scan.last.block.height)}` : `no block in the last ${fmtInt(slotsScanned)} slots carried one`}
          />
        </div>
        {cells.length === 0 ? (
          <Loading label="Reading the first epoch…" />
        ) : scan.withTx > 0 ? (
          <TxLandings cells={cells} />
        ) : (
          <div className="state" style={{ marginBottom: 10 }}>
            No block in slots {fmtInt(lowSlot)}–{fmtInt(head.slot)} carried a transaction. Usual here: an
            empty mempool this early is expected, and the opening ledger was issued at genesis rather
            than transferred into place.
          </div>
        )}
        <div className="an-load">
          <button className="btn btn-sm" disabled={!canLoad} onClick={() => oldest !== null && void loadBatch(head, oldest - 1, BATCH)}>
            {busy ? "reading…" : rows.length >= MAX_EPOCHS ? `${MAX_EPOCHS} epochs is the most this page scans` : `scan ${BATCH} older epochs`}
          </button>
          <span className="lookup-hint" style={{ margin: 0 }}>
            Each epoch is {PARAMS.slotsPerEpoch.value} slot reads through the edge, which serves a
            finalised slot from cache for a week. Measured 2026-09-01: a full sweep of slots
            48,500–54,540 read 5,252 blocks and found <strong>two</strong> transactions, at heights
            30,907 and 30,909 — an observation with a date on it; the window above is the live one.
          </span>
        </div>
      </section>}

      <div className="grid two-col" style={{ marginBottom: 14 }}>
        <section className="card">
          <h2 className="snap-h2">Check an outpoint</h2>
          <p className="lookup-hint" style={{ marginTop: 0 }}>
            Check whether a known output is still unspent. Paste its transaction ID and output index.
          </p>
          <OutpointCheck />
        </section>
        <section className="card">
          <h2 className="snap-h2">Status and transaction history</h2>
          <p className="snap-body">
            Use a transaction ID to read its current observer-reported status above, or open its
            transaction page. This lookup works independently of the historical index.
          </p>
          <p className="snap-body">
            The list of transaction IDs, inputs, outputs and fees requires an indexer of block
            bodies. The block RPC currently provides a header and transaction count; it does not
            provide that complete list. An unavailable index does not mean a transaction failed.
          </p>
          <p className="snap-body" style={{ marginBottom: 0 }}>
            For a known recipient, <Link to="/hash">check the balance</Link>. For a known output,
            use the outpoint check. An output that is not currently unspent does not by itself
            establish whether a transaction existed or was finalized.
          </p>
        </section>
      </div>
    </div>
  );
}
