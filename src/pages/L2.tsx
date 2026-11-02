// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Bloch L2 explorer (EVM, chain id 700770): /l2, /l2/blocks/:from,
// /l2/block/:id, /l2/tx/:hash, /l2/address/:addr.
//
// /l2/bridge (deposits and withdrawal claims).
//
// Two sources, never mixed:
//  - the L1 settlement record (`getl2settlement`, via /l2status, corroborated
//    across the explorer's L1 observers): activation, the accepted settlement,
//    the deposit inbox and escrow, the withdrawal tree, claims, attestor set;
//  - the settled L2 RPC (via /l2rpc), read at `safe`/`finalized` only: blocks,
//    transactions, receipts, logs and balances at or below the settled bound.
// There is no indexer: blocks, transactions and receipts are direct reads;
// token transfers come from eth_getLogs over the settled chain; native
// transactions of an address are found by reading a stated range of blocks.
// Finality badges show the L2 RPC's own `safe` / `finalized` tags.

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useRouter } from "../lib/router";
import { Copyable, KV } from "../components/ui";
import { fmtInt, fmtTime, timeAgo, short } from "../lib/format";
import { pollWhileVisible } from "../lib/polling";
import {
  acceptedDiffers,
  blockLevel,
  NOT_SETTLED,
  chainReplaced,
  finalityNotice,
  FinalityLevels,
  SeenTip,
  L2Block,
  L2Log,
  L2Receipt,
  L2RpcError,
  L2Tx,
  LEVEL_TEXT,
  Level,
  Settlement,
  TokenMeta,
  TokenTransfer,
  AddressScan,
  Head,
  L2_CHAIN_ID,
  OUTBOX,
  Withdrawal,
  decodeWithdrawal,
  publicRpcUrl,
  readWithdrawals,
  classifyQuery,
  decodeTransfer,
  fmtGwei,
  fmtNative,
  hexBig,
  hexNum,
  isAddress,
  isHash32,
  l2Batch,
  l2Call,
  levelOf,
  methodOf,
  ok,
  predeployLabel,
  readAddressTransfers,
  readHead,
  readSettlement,
  readTokenBalances,
  readTokenMeta,
  scanAddressTxs,
  tokenAmount,
  txFee,
  txStatus,
} from "../lib/l2";
import {
  L2SettlementRecord,
  L2StatusEnvelope,
  WithdrawalStage,
  epochOfSlot,
  fmtSats,
  l2Phase,
  readL2Status,
  timeOfSlot,
  withdrawalStage,
} from "../lib/l2settlement";
import "../l2.css";

// ─── shared bits ────────────────────────────────────────────────────────────

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e) => live && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, rev]);
  return { ...state, reload: () => setRev((r) => r + 1) };
}

function useHead() {
  const [head, setHead] = useState<(Head & { at: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<SeenTip | null>(null);
  const rewinds = useRef(0);
  useEffect(
    () =>
      pollWhileVisible(async () => {
        try {
          const h = await readHead();
          servedChainId = h.chainId;
          // Compare against the tag's own block, so a closed level and a reopening keep the last tip seen.
          const f = h.finality;
          const tip: SeenTip | null =
            f.safe !== null && f.safeHash ? { number: f.safe, hash: f.safeHash } : f.finalized !== null && f.finalizedHash ? { number: f.finalized, hash: f.finalizedHash } : null;
          if (tip) {
            let atOld: string | null = null;
            if (seen.current && tip.number > seen.current.number) {
              const old = await l2Call<L2Block | null>("eth_getBlockByNumber", ["0x" + seen.current.number.toString(16), false]).catch(() => null);
              atOld = old ? old.hash.toLowerCase() : null;
            }
            if (chainReplaced(seen.current, tip, atOld)) rewinds.current += 1;
            seen.current = tip;
          }
          setHead({ ...h, rewinds: rewinds.current, at: Date.now() });
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }, 15_000),
    [],
  );
  return { head, error };
}

let servedChainId: number | null = null;

/** Changes when a level opens, closes or moves, so that a page rereads what it shows at that level. */
const levelKey = (head: Head | null) => {
  const f = head?.finality;
  return f ? `${f.safe}:${f.finalized}:${f.safeHash}:${f.finalizedHash}` : "";
};

/** The L1 settlement record (GET /l2status), polled. */
function useL2Status() {
  const [status, setStatus] = useState<L2StatusEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      pollWhileVisible(async () => {
        try {
          setStatus(await readL2Status());
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }, 30_000),
    [],
  );
  return { status, error };
}

function Shell({ title, lede, children }: { title: ReactNode; lede?: ReactNode; children: ReactNode }) {
  const id = servedChainId ?? L2_CHAIN_ID;
  return (
    <div className="container l2">
      <div className="l2-top">
        <Link to="/l2" className="l2-brand">
          Bloch L2{id !== L2_CHAIN_ID ? " devnet" : ""} <span className="pill quiet pill-sm">chain id {id}</span>
        </Link>
        <L2Search />
      </div>
      <h1 className="page-title">{title}</h1>
      {lede && <p className="page-lede">{lede}</p>}
      {children}
    </div>
  );
}

function Failure({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="err-box" role="alert">
      <strong>The L2 RPC could not answer:</strong> {error}
      {onRetry && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-sm" type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="loading">
      <span className="spinner" /> Reading the L2 RPC…
    </div>
  );
}

export function LevelPill({ level, title }: { level: Level; title?: string }) {
  const t = LEVEL_TEXT[level];
  return (
    <span className={t.pill + " pill-sm"} title={title ?? t.help}>
      {t.label}
    </span>
  );
}

function Addr({ a, self }: { a: string | null | undefined; self?: string }) {
  if (!a) return <span className="g4-dim">none</span>;
  const label = predeployLabel(a);
  const text = short(a, 10, 8);
  if (self && a.toLowerCase() === self.toLowerCase()) return <code title={a}>{text}</code>;
  return (
    <span>
      <Link className="mono-link" to={`/l2/address/${a.toLowerCase()}`} title={a}>
        {text}
      </Link>
      {label && <span className="g4-dim"> ({label})</span>}
    </span>
  );
}

function TxLink({ h, full }: { h: string; full?: boolean }) {
  return (
    <Link className="mono-link" to={`/l2/tx/${h.toLowerCase()}`} title={h}>
      {full ? h : short(h, 10, 8)}
    </Link>
  );
}

function BlockLink({ n }: { n: number }) {
  return (
    <Link className="mono-link" to={`/l2/block/${n}`}>
      {fmtInt(n)}
    </Link>
  );
}

function StatusPill({ r }: { r: L2Receipt | null | undefined }) {
  const s = txStatus(r);
  return <span className={"pill pill-sm " + (s === "success" ? "ok" : s === "failed" ? "bad" : "quiet")}>{s === "success" ? "Success" : s === "failed" ? "Failed" : "Pending"}</span>;
}

export function L2Search() {
  const { navigate } = useRouter();
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    const t = classifyQuery(q);
    setMsg(null);
    if (t.kind === "block") return navigate(`/l2/block/${t.number}`);
    if (t.kind === "address") return navigate(`/l2/address/${t.address}`);
    if (t.kind === "hash") {
      try {
        const [tx, blk] = await l2Batch([
          { method: "eth_getTransactionByHash", params: [t.hash] },
          { method: "eth_getBlockByHash", params: [t.hash, false] },
        ]);
        if (tx && !(tx instanceof L2RpcError)) return navigate(`/l2/tx/${t.hash}`);
        if (blk && !(blk instanceof L2RpcError)) return navigate(`/l2/block/${t.hash}`);
        setMsg("No L2 transaction or block has that hash.");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    setMsg("Enter a block number, a transaction or block hash, or a 0x address.");
  };
  return (
    <form
      className="l2-search"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <input
        aria-label="Search the Bloch L2"
        placeholder="Block number, tx hash, block hash or 0x address"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        spellCheck={false}
      />
      <button className="btn btn-sm" type="submit">
        Search
      </button>
      {msg && <span className="l2-search-msg">{msg}</span>}
    </form>
  );
}

/** Says when the levels on this page are closed, lowered or not current. */
function FinalityBanner({ head }: { head: Head | null }) {
  const notice = finalityNotice(head?.finality ?? null);
  if (!notice) return null;
  return (
    <div className={"card l2-live l2-live-wait"} role="status">
      <span className={"pill pill-sm " + (notice.severity === "bad" ? "bad" : "warn")}>{notice.severity === "bad" ? "closed" : "note"}</span> {notice.text}
    </div>
  );
}

function FinalityStrip({ head, error }: ReturnType<typeof useHead>) {
  if (!head && error) return null;
  if (!head) return <Loading />;
  const f = head.finality;
  return (
    <>
    <FinalityBanner head={head} />
    <div className="g4-grid card l2-finality">
      <div className="g4-stat">
        <span className="g4-k">Safe (shown here)</span>
        <span className="g4-v">{f.safeClosed ? "unavailable" : f.safe === null ? "none yet" : <BlockLink n={f.safe} />}</span>
        <span className="g4-dim">settlement accepted at the L1 head</span>
      </div>
      <div className="g4-stat">
        <span className="g4-k">Finalized</span>
        <span className="g4-v">{f.finalizedClosed ? "unavailable" : f.finalized === null ? "none yet" : <BlockLink n={f.finalized} />}</span>
        <span className="g4-dim">settlement in an FFG-finalized L1 block</span>
      </div>
      <div className="g4-stat">
        <span className="g4-k">Sequencer head</span>
        <span className="g4-v">{f.latest === null ? "not reported" : fmtInt(f.latest)}</span>
        <span className="g4-dim">executed, not shown until settled</span>
      </div>
      <div className="g4-stat">
        <span className="g4-k">L1 finalized checkpoint</span>
        <span className="g4-v">
          {f.l1FinalizedSlot !== null ? <Link to={`/slot/${f.l1FinalizedSlot}`}>slot {fmtInt(f.l1FinalizedSlot)}</Link> : "not reported"}
        </span>
        <span className="g4-dim">{f.l1FinalizedEpoch !== null ? `epoch ${fmtInt(f.l1FinalizedEpoch)}, as replayed by the L2 follower` : head.finalityServed ? "" : "bloch_finality not served"}</span>
      </div>
    </div>
    </>
  );
}

function Hash({ h, n = 10 }: { h: string | null | undefined; n?: number }) {
  if (!h) return <span className="g4-dim">not reported</span>;
  return <code title={h}>{short(h, n, 8)}</code>;
}

function Corroboration({ st }: { st: L2StatusEnvelope }) {
  if (st.chainMismatch) return <span className="pill bad pill-sm">L1 record is for another chain id</span>;
  if (st.corroborated) {
    return (
      <span className="pill ok pill-sm" title="Identical settlement fields from this many independent L1 observers">
        {st.agreeing} of {st.responding} L1 observers agree
      </span>
    );
  }
  return (
    <span className="pill warn pill-sm" title="Fewer than the quorum of L1 observers returned identical settlement fields">
      {st.divergent ? "L1 observers disagree" : `uncorroborated (${st.agreeing} of ${st.responding})`}
    </span>
  );
}

/** The one-line honest state of the L2, shown at the top of /l2. */
function LiveState({ ls, hs }: { ls: ReturnType<typeof useL2Status>; hs: ReturnType<typeof useHead> }) {
  const rec = ls.status?.record ?? null;
  const phase = l2Phase(rec, !!ls.status);
  const rpcDown = !hs.head && !!hs.error;
  const rpc = publicRpcUrl();
  let title: ReactNode;
  let body: ReactNode;
  if (phase === "unknown") {
    title = ls.error ? "The L1 settlement record could not be read" : "Reading the L1 settlement record…";
    body = ls.error ? <span className="g4-dim">{ls.error}</span> : null;
  } else if (phase === "not-installed") {
    title = "No Bloch L2 is installed on the L1";
    body = "The L1 reports no installed L2 for this chain.";
  } else if (phase === "activated-unsettled") {
    title = "Not yet live: activated on the L1, no L2 block settled yet";
    body = (
      <>
        The L2 was activated on the L1{rec?.source?.slot != null ? <> at <Link to={`/slot/${rec.source.slot}`}>slot {fmtInt(rec.source.slot)}</Link> (epoch {fmtInt(epochOfSlot(rec.source.slot))}, {fmtTime(timeOfSlot(rec.source.slot))})</> : null}.
        The L1 has accepted no settlement, so the L2 holds only its genesis block and no deposit, transaction or withdrawal exists.
        {rpcDown ? <> The public L2 RPC (<code>{rpc}</code>) is not reachable yet.</> : null}
      </>
    );
  } else {
    const st = rec?.accepted?.statement;
    title = "Live: L2 blocks are settled on the L1";
    body = (
      <>
        Latest accepted settlement: L2 block {st ? <BlockLink n={st.l2Number} /> : "(statement not decoded)"}.
        {rpcDown ? <> The public L2 RPC (<code>{rpc}</code>) is not reachable from this page right now; the L1 record below is still current.</> : null}
      </>
    );
  }
  return (
    <div className={"card l2-live " + (phase === "settling" ? "l2-live-ok" : "l2-live-wait")} role="status">
      <strong>{title}</strong>
      {body && <p>{body}</p>}
    </div>
  );
}

/** Activation, settlement head, escrow and attestor set, from the L1 record. */
function L1StatusPanel({ ls, head }: { ls: ReturnType<typeof useL2Status>; head: Head | null }) {
  const st = ls.status;
  if (!st) return ls.error ? <Failure error={`L1 settlement record: ${ls.error}`} /> : <Loading />;
  const rec = st.record;
  if (!rec) {
    return (
      <section className="card">
        <h2 className="snap-h2">On the Bloch L1</h2>
        <p>The L1 reports no installed L2 (getl2settlement returned null). <Corroboration st={st} /></p>
      </section>
    );
  }
  const acc = rec.accepted;
  const stmt = acc?.statement ?? null;
  const fin = head?.finality.finalized ?? null;
  const accFinalized = stmt && fin !== null ? stmt.l2Number <= fin : null;
  const finClosed = head?.finality.finalizedClosed ?? false;
  const accepted = useLoad(async () => (stmt ? l2Call<L2Block | null>("eth_getBlockByNumber", ["0x" + stmt.l2Number.toString(16), false]).catch(() => null) : null), [stmt?.l2Number ?? null, head?.rewinds ?? 0]);
  const differs = acceptedDiffers(stmt?.l2HeaderHash ?? null, accepted.data?.hash ?? null);
  const rows: [string, ReactNode][] = [
    ["Chain id", <>{rec.chainId ?? "not reported"} {rec.chainId !== null && rec.chainId !== st.expectedChainId && <span className="pill bad pill-sm">expected {st.expectedChainId}</span>}</>],
    [
      "Activation",
      rec.activated ? (
        <>
          <span className="pill ok pill-sm">activated</span>{" "}
          {rec.source?.slot != null && (
            <>
              source block at <Link to={`/slot/${rec.source.slot}`}>slot {fmtInt(rec.source.slot)}</Link> (epoch {fmtInt(epochOfSlot(rec.source.slot))}) <Hash h={rec.source.block} />
            </>
          )}
        </>
      ) : (
        <span className="pill quiet pill-sm">not activated</span>
      ),
    ],
    ["Admits", `${rec.depositsEnabled ? "deposits" : "no deposits"}, ${rec.userTransactions ? "user transactions" : "no user transactions"}${rec.asynchronous ? ", asynchronous settlement" : ""}`],
    [
      "Latest settlement accepted",
      acc ? (
        <>
          L2 block {stmt ? <BlockLink n={stmt.l2Number} /> : "?"} <span className="g4-dim">commitment</span> <Hash h={acc.commitment} />
          {stmt && <span className="g4-dim"> · statement v{stmt.version}, built on L1 slot {fmtInt(stmt.l1SourceSlot)}</span>}
        </>
      ) : (
        <span>none: the L1 has accepted no settlement, the L2 is at its genesis</span>
      ),
    ],
    [
      "Latest settlement finalized",
      !acc ? (
        <span>none</span>
      ) : differs ? (
        <><LevelPill level="conflict" /> the L1 accepted another block at this height than the L2 RPC serves: a foreign settlement or a fault</>
      ) : accFinalized === null ? (
        <span className="g4-dim">{finClosed ? "unknown: finality is unavailable at this L2 RPC" : "unknown: the L2 RPC did not report its finalized block"}</span>
      ) : accFinalized ? (
        <><LevelPill level="finalized" /> the L2 RPC reports block {fmtInt(fin!)} finalized</>
      ) : (
        <><LevelPill level="safe" /> accepted, not yet in an FFG-finalized L1 block (finalized: {fin === null ? "none" : fmtInt(fin)})</>
      ),
    ],
    ["Next settlement source", rec.source ? <>L1 slot {rec.source.slot !== null ? fmtInt(rec.source.slot) : "?"}, height {rec.source.height ?? "?"}, inbox {rec.source.inboxCount ?? "?"}</> : "not reported"],
    ["Escrow on the L1", <>{fmtSats(rec.inbox.escrowSat)} {rec.withdrawals.escrowConserved !== null && <span className={"pill pill-sm " + (rec.withdrawals.escrowConserved ? "ok" : "bad")}>{rec.withdrawals.escrowConserved ? "conserved" : "NOT conserved"}</span>}</>],
    ["Deposits", <>{fmtInt(rec.inbox.count ?? 0)} in the inbox, {fmtInt(rec.inbox.consumed ?? 0)} minted on the L2 · <Link to="/l2/bridge">details</Link></>],
    ["Withdrawals", <>{fmtInt(rec.withdrawals.count ?? 0)} settled, {fmtInt(rec.withdrawals.claimedCount ?? 0)} claimed, {fmtSats(rec.withdrawals.releasedSat)} released · <Link to="/l2/bridge">details</Link></>],
    [
      "Attestor set",
      rec.withdrawals.attestorSet ? (
        <>
          <Hash h={rec.withdrawals.attestorSet} n={12} /> <span className="g4-dim">required for claims of {fmtSats(rec.withdrawals.attestedClaimSat)} or more</span>
        </>
      ) : (
        <span className="g4-dim">none (no attestor signatures required)</span>
      ),
    ],
    ["Data-availability records", fmtInt(rec.daRecords.length)],
    ["Read from", <><Corroboration st={st} /> {rec.l1Height !== null && <span className="g4-dim">at L2-record height {fmtInt(rec.l1Height)}</span>}</>],
  ];
  return (
    <section className="card">
      <h2 className="snap-h2">On the Bloch L1</h2>
      <KV rows={rows} />
    </section>
  );
}

// ─── /l2 ────────────────────────────────────────────────────────────────────

const PAGE = 25;

async function readBlocks(from: number, count: number): Promise<{ blocks: L2Block[]; receipts: Map<string, L2Receipt> }> {
  const nums: number[] = [];
  for (let n = from; n > from - count && n >= 0; n--) nums.push(n);
  const rs = await l2Batch(nums.map((n) => ({ method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), true] })));
  const blocks = rs.map((r) => ok<L2Block | null>(r)).filter((b): b is L2Block => !!b);
  const withTx = blocks.filter((b) => b.transactions.length > 0);
  const receipts = new Map<string, L2Receipt>();
  if (withTx.length) {
    const rr = await l2Batch(withTx.map((b) => ({ method: "eth_getBlockReceipts", params: [b.number] })));
    for (const r of rr) {
      if (r instanceof L2RpcError || !Array.isArray(r)) continue;
      for (const x of r as L2Receipt[]) receipts.set(x.transactionHash.toLowerCase(), x);
    }
  }
  return { blocks, receipts };
}

function BlocksTable({ blocks, finality }: { blocks: L2Block[]; finality: FinalityLevels | null }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Block</th>
            <th>Status</th>
            <th>Age</th>
            <th>Txs</th>
            <th>Gas used</th>
            <th>Hash</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => {
            const n = hexNum(b.number);
            return (
              <tr key={b.hash}>
                <td>
                  <BlockLink n={n} />
                </td>
                <td>
                  <LevelPill level={levelOf(n, finality)} />
                </td>
                <td title={fmtTime(hexNum(b.timestamp))}>{timeAgo(hexNum(b.timestamp))}</td>
                <td>{b.transactions.length}</td>
                <td>{fmtInt(hexNum(b.gasUsed))}</td>
                <td>
                  <code title={b.hash}>{short(b.hash, 10, 8)}</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TxTable({ rows, receipts, self }: { rows: { tx: L2Tx; timestamp?: number }[]; receipts?: Map<string, L2Receipt>; self?: string }) {
  if (rows.length === 0) return <p className="g4-dim">No transactions.</p>;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Method</th>
            <th>Block</th>
            {rows[0].timestamp !== undefined && <th>Age</th>}
            <th>From</th>
            <th>To</th>
            <th>Value</th>
            {receipts && <th>Status</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ tx, timestamp }) => {
            const r = receipts?.get(tx.hash.toLowerCase());
            return (
              <tr key={tx.hash}>
                <td>
                  <TxLink h={tx.hash} />
                </td>
                <td>
                  <code>{tx.to ? methodOf(tx.input) : "Contract creation"}</code>
                </td>
                <td>{tx.blockNumber ? <BlockLink n={hexNum(tx.blockNumber)} /> : "pending"}</td>
                {timestamp !== undefined && <td title={fmtTime(timestamp)}>{timeAgo(timestamp)}</td>}
                <td>
                  <Addr a={tx.from} self={self} />
                </td>
                <td>{tx.to ? <Addr a={tx.to} self={self} /> : r?.contractAddress ? <Addr a={r.contractAddress} /> : <span className="g4-dim">new contract</span>}</td>
                <td>{fmtNative(hexBig(tx.value))}</td>
                {receipts && (
                  <td>
                    <StatusPill r={r} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function L2HomePage() {
  const hs = useHead();
  const ls = useL2Status();
  const top = hs.head?.head ?? null;
  const data = useLoad(async () => (top === null ? null : readBlocks(top, PAGE)), [top]);
  const txRows = useMemo(() => {
    if (!data.data) return [];
    const rows: { tx: L2Tx; timestamp: number }[] = [];
    for (const b of data.data.blocks) for (const t of b.transactions) if (typeof t !== "string") rows.push({ tx: t, timestamp: hexNum(b.timestamp) });
    return rows.slice(0, PAGE);
  }, [data.data]);
  const unsettled = !!ls.status?.record && !ls.status.record.accepted;
  return (
    <Shell
      title="Bloch L2 explorer"
      lede={
        <>
          The Bloch L2 is an EVM rollup settled on the Bloch L1 (chain id {L2_CHAIN_ID}). This explorer shows only L2 blocks whose
          settlement the L1 has accepted (<b>Safe</b>) or finalized (<b>Finalized</b>); blocks the sequencer has executed but not yet
          settled are not shown. Native currency: bridged BLCH (18 decimals on the L2).
        </>
      }
    >
      <LiveState ls={ls} hs={hs} />
      <L1StatusPanel ls={ls} head={hs.head} />
      <section className="card">
        <h2 className="snap-h2">L2 RPC</h2>
        <KV
          rows={[
            ["Public RPC (wallets)", <><code>{publicRpcUrl()}</code> <span className="g4-dim">chain id {L2_CHAIN_ID}</span></>],
            [
              "State",
              hs.head ? (
                <span className="pill ok pill-sm">answering</span>
              ) : hs.error ? (
                <>
                  <span className="pill warn pill-sm">{unsettled ? "not live yet" : "unreachable"}</span> <span className="g4-dim">{hs.error}</span>
                </>
              ) : (
                "…"
              ),
            ],
          ]}
        />
      </section>
      {hs.head && <FinalityStrip {...hs} />}
      {(hs.head || !hs.error) && (
        <section className="card">
          <h2 className="snap-h2">Settled blocks</h2>
          {top === null && hs.head ? (
            <p className="g4-dim">The L2 RPC reports no safe block yet: its follower has not verified the L1 that holds this L2's genesis.</p>
          ) : data.error ? (
            <Failure error={data.error} onRetry={data.reload} />
          ) : !data.data ? (
            <Loading />
          ) : (
            <BlocksTable blocks={data.data.blocks} finality={hs.head?.finality ?? null} />
          )}
          {top !== null && top >= PAGE && (
            <p>
              <Link to={`/l2/blocks/${top - PAGE}`}>Older blocks</Link>
            </p>
          )}
          {top === 0 && <p className="g4-dim">Only the genesis block exists: no settlement has been accepted on the L1.</p>}
        </section>
      )}
      {data.data && txRows.length > 0 && (
        <section className="card">
          <h2 className="snap-h2">Transactions in these blocks</h2>
          <TxTable rows={txRows} receipts={data.data.receipts} />
          <p className="g4-dim">
            From blocks {fmtInt(hexNum(data.data.blocks[data.data.blocks.length - 1].number))} to {fmtInt(hexNum(data.data.blocks[0].number))}.
          </p>
        </section>
      )}
      {data.data && txRows.length === 0 && (
        <section className="card">
          <h2 className="snap-h2">Transactions</h2>
          <p className="g4-dim">No transactions in the settled blocks shown.</p>
        </section>
      )}
    </Shell>
  );
}

export function L2BlocksPage({ from }: { from: number }) {
  const hs = useHead();
  const data = useLoad(() => readBlocks(from, PAGE), [from]);
  return (
    <Shell title={`L2 blocks ${fmtInt(Math.max(0, from - PAGE + 1))} to ${fmtInt(from)}`}>
      {data.error ? <Failure error={data.error} onRetry={data.reload} /> : !data.data ? <Loading /> : <BlocksTable blocks={data.data.blocks} finality={hs.head?.finality ?? null} />}
      <p className="l2-pager">
        {hs.head?.head != null && from + PAGE <= hs.head.head ? <Link to={`/l2/blocks/${from + PAGE}`}>Newer</Link> : <Link to="/l2">Latest</Link>}
        {from - PAGE >= 0 && <Link to={`/l2/blocks/${from - PAGE}`}>Older</Link>}
      </p>
    </Shell>
  );
}

// ─── /l2/block/:id ──────────────────────────────────────────────────────────

function SettlementPanel({ n, hash, finality, settlement }: { n: number; hash: string; finality: FinalityLevels | null; settlement: Settlement | null | undefined }) {
  const level = blockLevel({ number: "0x" + n.toString(16), hash }, finality, settlement);
  const rows: [string, ReactNode][] = [["Status", <><LevelPill level={level} /> <span className="g4-dim">{LEVEL_TEXT[level].help}</span></>]];
  if (settlement && settlement.l2Number === n) {
    if (settlement.l1Slot !== null) rows.push(["L1 block with the settlement", <Link to={`/slot/${settlement.l1Slot}`}>slot {fmtInt(settlement.l1Slot)}</Link>]);
    if (settlement.l1Block) rows.push(["L1 block id", <Link className="mono-link" to={`/block/${settlement.l1Block}`}>{short(settlement.l1Block, 12, 12)}</Link>]);
    if (settlement.commitment) rows.push(["Settlement commitment", <code>{settlement.commitment}</code>]);
  } else if (level === "finalized" || level === "safe") {
    if (finality?.safeL2Number === n && finality.safeCommitment) rows.push(["Settlement commitment", <code>{finality.safeCommitment}</code>]);
    rows.push([
      "L1 settlement block",
      <span className="g4-dim">This RPC does not report which L1 block holds each settlement (bloch_settlement not served).</span>,
    ]);
  }
  if (level === "finalized" && finality?.l1FinalizedSlot != null) {
    rows.push([
      "L1 finalized checkpoint",
      <>
        <Link to={`/slot/${finality.l1FinalizedSlot}`}>slot {fmtInt(finality.l1FinalizedSlot)}</Link>
        {finality.l1FinalizedEpoch !== null && <span className="g4-dim"> (epoch {fmtInt(finality.l1FinalizedEpoch)}); the settlement is at or before it</span>}
      </>,
    ]);
  }
  return (
    <section className="card">
      <h2 className="snap-h2">Settlement on the Bloch L1</h2>
      <KV rows={rows} />
    </section>
  );
}

export function L2BlockPage({ id }: { id: string }) {
  const hs = useHead();
  const data = useLoad(async () => {
    const byHash = isHash32(id);
    const ref = byHash ? id : "0x" + Number(id).toString(16);
    const [b, rc] = await l2Batch([
      { method: byHash ? "eth_getBlockByHash" : "eth_getBlockByNumber", params: [ref, true] },
      { method: "eth_getBlockReceipts", params: [ref] },
    ]);
    const block = ok<L2Block | null>(b);
    if (!block) return null;
    const receipts = new Map<string, L2Receipt>();
    if (Array.isArray(rc)) for (const r of rc as L2Receipt[]) receipts.set(r.transactionHash.toLowerCase(), r);
    const settlement = await readSettlement(hexNum(block.number));
    return { block, receipts, settlement };
  }, [id, hs.head?.rewinds ?? 0, levelKey(hs.head)]);
  const closedHere = hs.head?.finality.finalizedClosed || hs.head?.finality.safeClosed;
  if (data.error) return <Shell title="L2 block"><Failure error={data.error} onRetry={data.reload} /></Shell>;
  if (data.loading && !data.data) return <Shell title="L2 block"><Loading /></Shell>;
  if (!data.data) {
    return (
      <Shell title="L2 block not found">
        <p className="page-lede">
          {closedHere ? <>Block <code>{id}</code> cannot be shown as settled by this L2 RPC now</> : <>No settled L2 block <code>{id}</code></>}
          {hs.head?.head != null ? <> (the newest settled block is <BlockLink n={hs.head.head} />)</> : null}. This explorer shows a block
          only once the L1 has accepted its settlement; a block the sequencer executed but has not settled yet is not shown.
        </p>
        <FinalityBanner head={hs.head} />
      </Shell>
    );
  }
  const { block: b, receipts, settlement } = data.data;
  const n = hexNum(b.number);
  const txs = b.transactions.filter((t): t is L2Tx => typeof t !== "string");
  const conf = hs.head?.head != null ? hs.head.head - n + 1 : null;
  return (
    <Shell title={<>L2 block {fmtInt(n)} <LevelPill level={blockLevel(b, hs.head?.finality ?? null, settlement)} /></>}>
      <FinalityBanner head={hs.head} />
      <section className="card">
        <KV
          rows={[
            ["Block hash", <Copyable text={b.hash} />],
            ["Parent", n > 0 ? <Link className="mono-link" to={`/l2/block/${n - 1}`}>{b.parentHash}</Link> : <code>{b.parentHash}</code>],
            ["Timestamp", <>{fmtTime(hexNum(b.timestamp))} <span className="g4-dim">({timeAgo(hexNum(b.timestamp))})</span></>],
            ["Settled blocks on top", conf === null ? "…" : fmtInt(Math.max(conf - 1, 0))],
            ["Transactions", fmtInt(txs.length)],
            ["Gas used / limit", `${fmtInt(hexNum(b.gasUsed))} / ${fmtInt(hexNum(b.gasLimit))}`],
            ["Base fee", b.baseFeePerGas ? fmtGwei(hexBig(b.baseFeePerGas)) : "none"],
            ["Fee recipient", <Addr a={b.miner} />],
            ["State root", <code>{b.stateRoot}</code>],
            ...(b.anchorRoot ? ([["L1 anchor root", <code title="The L1 block this L2 block was built on (its parentBeaconBlockRoot)">{b.anchorRoot}</code>]] as [string, ReactNode][]) : []),
            ...(b.depositsHash ? ([["Deposits hash", <code>{b.depositsHash}</code>]] as [string, ReactNode][]) : []),
          ]}
        />
        <p className="l2-pager">
          {n > 0 && <Link to={`/l2/block/${n - 1}`}>Previous block</Link>}
          {hs.head?.head != null && n < hs.head.head && <Link to={`/l2/block/${n + 1}`}>Next block</Link>}
        </p>
      </section>
      <SettlementPanel n={n} hash={b.hash} finality={hs.head?.finality ?? null} settlement={settlement} />
      <section className="card">
        <h2 className="snap-h2">Transactions</h2>
        <TxTable rows={txs.map((tx) => ({ tx }))} receipts={receipts} />
      </section>
    </Shell>
  );
}

// ─── /l2/tx/:hash ───────────────────────────────────────────────────────────

function LogsTable({ logs, meta }: { logs: L2Log[]; meta: Map<string, TokenMeta> }) {
  if (logs.length === 0) return <p className="g4-dim">No events.</p>;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>Contract</th>
            <th>Event</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => {
            const t = decodeTransfer(l);
            const wd = t ? null : decodeWithdrawal(l);
            return (
              <tr key={l.logIndex}>
                <td>{hexNum(l.logIndex)}</td>
                <td>
                  <Addr a={l.address} />
                </td>
                <td>
                  {t ? (
                    <span>
                      {t.standard} Transfer <Addr a={t.from} /> → <Addr a={t.to} />{" "}
                      <b>{t.standard === "ERC-721" ? `token #${t.value}` : tokenAmount(t.value, meta.get(t.token))}</b>
                    </span>
                  ) : wd ? (
                    <span>
                      Withdrawal #{fmtInt(wd.nonce)} of <b>{fmtNative(wd.amountWei)}</b> to L1 owner <code title={wd.l1Recipient}>{short(wd.l1Recipient, 10, 8)}</code> ·{" "}
                      <Link to="/l2/bridge">claim status</Link>
                    </span>
                  ) : (
                    <code className="l2-topic" title={l.topics.join("\n")}>
                      {l.topics[0] ? short(l.topics[0], 10, 6) : "anonymous"} · {Math.max(0, (l.data.length - 2) / 2)} bytes
                    </code>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function L2TxPage({ hash }: { hash: string }) {
  const hs = useHead();
  const data = useLoad(async () => {
    const [t, r] = await l2Batch([
      { method: "eth_getTransactionByHash", params: [hash] },
      { method: "eth_getTransactionReceipt", params: [hash] },
    ]);
    const tx = ok<L2Tx | null>(t);
    if (!tx) return null;
    const receipt = r instanceof L2RpcError ? null : (r as L2Receipt | null);
    let timestamp: number | null = null;
    if (tx.blockNumber) {
      const b = await l2Call<L2Block | null>("eth_getBlockByNumber", [tx.blockNumber, false]);
      timestamp = b ? hexNum(b.timestamp) : null;
    }
    const tokens = [...new Set((receipt?.logs ?? []).map(decodeTransfer).filter((x): x is TokenTransfer => !!x && x.standard === "ERC-20").map((x) => x.token))];
    const meta = tokens.length ? await readTokenMeta(tokens) : new Map<string, TokenMeta>();
    return { tx, receipt, timestamp, meta };
  }, [hash, hs.head?.rewinds ?? 0, levelKey(hs.head)]);
  if (data.error) return <Shell title="L2 transaction"><Failure error={data.error} onRetry={data.reload} /></Shell>;
  if (data.loading && !data.data) return <Shell title="L2 transaction"><Loading /></Shell>;
  if (!data.data) {
    return (
      <Shell title="L2 transaction not found">
        <FinalityBanner head={hs.head} />
        <p className="page-lede">
          No settled L2 transaction <code>{hash}</code>. A transaction appears here once the block that includes it is settled on the
          L1 (accepted, shown as Safe); until then it is not shown, even if the sequencer has already executed it.
        </p>
      </Shell>
    );
  }
  const { tx, receipt, timestamp, meta } = data.data;
  const n = tx.blockNumber ? hexNum(tx.blockNumber) : null;
  const level = n === null ? "unknown" : tx.blockHash ? blockLevel({ number: tx.blockNumber!, hash: tx.blockHash }, hs.head?.finality ?? null, null) : levelOf(n, hs.head?.finality ?? null);
  const gasPrice = receipt ? hexBig(receipt.effectiveGasPrice) : hexBig(tx.gasPrice ?? tx.maxFeePerGas ?? "0x0");
  return (
    <Shell title={<>L2 transaction {n !== null && <LevelPill level={level} />}</>}>
      <FinalityBanner head={hs.head} />
      <section className="card">
        <KV
          rows={[
            ["Hash", <Copyable text={tx.hash} />],
            ["Status", <><StatusPill r={receipt} /> {receipt && n !== null && <span className="g4-dim">{LEVEL_TEXT[level].help}</span>}</>],
            ["Block", n === null ? "pending" : <><BlockLink n={n} /> {hs.head?.head != null && <span className="g4-dim">({fmtInt(Math.max(0, hs.head.head - n))} settled blocks on top)</span>}</>],
            ["Timestamp", timestamp === null ? "pending" : <>{fmtTime(timestamp)} <span className="g4-dim">({timeAgo(timestamp)})</span></>],
            ["From", <Addr a={tx.from} />],
            [tx.to ? "To" : "Contract created", tx.to ? <Addr a={tx.to} /> : <Addr a={receipt?.contractAddress ?? null} />],
            ["Value", fmtNative(hexBig(tx.value), 18)],
            ["Transaction fee", receipt ? fmtNative(txFee(receipt), 18) : "pending"],
            ["Gas price", fmtGwei(gasPrice)],
            ["Gas used / limit", `${receipt ? fmtInt(hexNum(receipt.gasUsed)) : "pending"} / ${fmtInt(hexNum(tx.gas))}`],
            ["Nonce · position", `${fmtInt(hexNum(tx.nonce))} · ${tx.transactionIndex ? fmtInt(hexNum(tx.transactionIndex)) : "pending"}`],
            ["Type", `${hexNum(tx.type)} (${["legacy", "EIP-2930", "EIP-1559", "EIP-4844", "EIP-7702"][hexNum(tx.type)] ?? "other"})`],
            ["Method", <code>{tx.to ? methodOf(tx.input) : "contract creation"}</code>],
            ["Input data", tx.input === "0x" ? <span className="g4-dim">none</span> : <details><summary>{fmtInt((tx.input.length - 2) / 2)} bytes</summary><code className="l2-input">{tx.input}</code></details>],
          ]}
        />
      </section>
      <section className="card">
        <h2 className="snap-h2">Events</h2>
        {receipt ? <LogsTable logs={receipt.logs} meta={meta} /> : <p className="g4-dim">No receipt yet.</p>}
      </section>
    </Shell>
  );
}

// ─── /l2/address/:addr ──────────────────────────────────────────────────────

const SCAN = 2000;

export function L2AddressPage({ address }: { address: string }) {
  const a = address.toLowerCase();
  const hs = useHead();
  const base = useLoad(async () => {
    const [bal, fbal, nonce, code] = await l2Batch([
      { method: "eth_getBalance", params: [a, "safe"] },
      { method: "eth_getBalance", params: [a, "finalized"] },
      { method: "eth_getTransactionCount", params: [a, "safe"] },
      { method: "eth_getCode", params: [a, "safe"] },
    ]);
    const isContract = typeof code === "string" && code !== "0x";
    const transfers = await readAddressTransfers(a);
    const tokenSet = new Set(transfers.filter((t) => t.standard === "ERC-20").map((t) => t.token));
    if (isContract) tokenSet.add(a);
    const meta = await readTokenMeta([...tokenSet]);
    const holdings = await readTokenBalances(a, [...tokenSet].filter((t) => t !== a || transfers.some((x) => x.token === t && (x.from === a || x.to === a))));
    let tokenFeed: TokenTransfer[] = [];
    const selfMeta = meta.get(a);
    if (isContract && selfMeta && (selfMeta.symbol || selfMeta.decimals !== null)) {
      const logs = await l2Call<L2Log[]>("eth_getLogs", [{ fromBlock: "0x0", toBlock: "safe", address: a, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] }]);
      tokenFeed = logs.map(decodeTransfer).filter((x): x is TokenTransfer => !!x).sort((x, y) => y.block - x.block || y.logIndex - x.logIndex);
    }
    return {
      balance: hexBig(ok<string>(bal)),
      finalizedBalance: fbal instanceof L2RpcError || fbal === null ? null : hexBig(fbal as string),
      finalizedRefused: fbal instanceof L2RpcError && fbal.code === NOT_SETTLED,
      nonce: hexNum(ok<string>(nonce)),
      code: typeof code === "string" ? code : "0x",
      transfers,
      meta,
      holdings,
      tokenFeed,
    };
  }, [a, hs.head?.rewinds ?? 0]);

  const [scan, setScan] = useState<AddressScan | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const head = hs.head?.head ?? null;
  const runScan = useCallback(
    async (to: number, prev: AddressScan | null) => {
      setScanning(true);
      setScanErr(null);
      try {
        const s = await scanAddressTxs(a, Math.max(0, to - SCAN + 1), to);
        setScan(prev ? { from: s.from, to: prev.to, txs: [...prev.txs, ...s.txs] } : s);
      } catch (e) {
        setScanErr(e instanceof Error ? e.message : String(e));
      } finally {
        setScanning(false);
      }
    },
    [a],
  );
  useEffect(() => {
    if (head !== null && scan === null && !scanning && !scanErr) void runScan(head, null);
  }, [head, scan, scanning, scanErr, runScan]);
  // A scan read before the settled chain was replaced lists transactions of the old branch.
  const rewinds = hs.head?.rewinds ?? 0;
  useEffect(() => {
    setScan(null);
    setScanErr(null);
  }, [rewinds]);

  if (!isAddress(address)) return <Shell title="Not an address"><p className="page-lede">Expected 0x followed by 40 hex characters.</p></Shell>;
  const d = base.data;
  const label = predeployLabel(a);
  const selfMeta = d?.meta.get(a);
  const isToken = !!(d && d.code !== "0x" && selfMeta && (selfMeta.symbol || selfMeta.decimals !== null));
  return (
    <Shell title={isToken ? `Token ${selfMeta?.symbol ?? ""}` : d && d.code !== "0x" ? "L2 contract" : "L2 address"} lede={label ?? undefined}>
      <section className="card">
        <KV
          rows={[
            ["Address", <Copyable text={a} />],
            ["Balance (safe)", d ? fmtNative(d.balance, 18) : base.error ? "unavailable" : "…"],
            ["Balance (finalized)", d ? (d.finalizedBalance === null ? <span className="g4-dim">{d.finalizedRefused ? "unavailable at this L2 RPC" : "no finalized block yet"}</span> : fmtNative(d.finalizedBalance, 18)) : "…"],
            ["Nonce (settled transactions sent)", d ? fmtInt(d.nonce) : "…"],
            ["Type", d ? (d.code === "0x" ? "Externally owned account" : `Contract (${fmtInt((d.code.length - 2) / 2)} bytes of code)`) : "…"],
            ...(isToken && selfMeta
              ? ([
                  ["Token", `${selfMeta.name ?? "unnamed"} (${selfMeta.symbol ?? "no symbol"})`],
                  ["Decimals", selfMeta.decimals === null ? "not reported" : String(selfMeta.decimals)],
                  ["Total supply", selfMeta.totalSupply === null ? "not reported" : tokenAmount(selfMeta.totalSupply, selfMeta)],
                ] as [string, ReactNode][])
              : []),
          ]}
        />
        {base.error && <Failure error={base.error} onRetry={base.reload} />}
      </section>

      {d && d.holdings.size > 0 && (
        <section className="card">
          <h2 className="snap-h2">Token balances</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {[...d.holdings].map(([t, v]) => (
                  <tr key={t}>
                    <td>
                      <Addr a={t} /> {d.meta.get(t)?.symbol && <span className="g4-dim">{d.meta.get(t)?.symbol}</span>}
                    </td>
                    <td>{v === null ? <span className="g4-dim">not reported</span> : tokenAmount(v, d.meta.get(t))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isToken && d && (
        <section className="card">
          <h2 className="snap-h2">Transfers of this token</h2>
          <TransfersTable rows={d.tokenFeed.slice(0, 100)} meta={d.meta} />
          <p className="g4-dim">{fmtInt(d.tokenFeed.length)} transfers in the whole chain{d.tokenFeed.length > 100 ? "; the latest 100 shown" : ""}.</p>
        </section>
      )}

      <section className="card">
        <h2 className="snap-h2">Token transfers</h2>
        {!d ? <Loading /> : <TransfersTable rows={d.transfers.slice(0, 100)} meta={d.meta} self={a} />}
        {d && <p className="g4-dim">{fmtInt(d.transfers.length)} ERC-20/ERC-721 transfers from or to this address in the whole chain{d.transfers.length > 100 ? "; the latest 100 shown" : ""}.</p>}
      </section>

      <AddressWithdrawals address={a} settledTop={head} rewinds={rewinds} />

      <section className="card">
        <h2 className="snap-h2">Transactions</h2>
        {scanErr && <Failure error={scanErr} onRetry={() => head !== null && void runScan(scan ? scan.from - 1 : head, scan)} />}
        {scan ? <TxTable rows={scan.txs} self={a} /> : !scanErr && <Loading />}
        {scan && (
          <p className="g4-dim">
            Read blocks {fmtInt(scan.from)} to {fmtInt(scan.to)} (the L2 RPC has no address index).{" "}
            {scan.from > 0 && (
              <button className="btn btn-sm" type="button" disabled={scanning} onClick={() => void runScan(scan.from - 1, scan)}>
                {scanning ? "Reading…" : `Read ${fmtInt(Math.min(SCAN, scan.from))} older blocks`}
              </button>
            )}
          </p>
        )}
      </section>
    </Shell>
  );
}

function TransfersTable({ rows, meta, self }: { rows: TokenTransfer[]; meta: Map<string, TokenMeta>; self?: string }) {
  if (rows.length === 0) return <p className="g4-dim">No token transfers.</p>;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Block</th>
            <th>From</th>
            <th>To</th>
            <th>Amount</th>
            <th>Token</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.txHash + t.logIndex}>
              <td>
                <TxLink h={t.txHash} />
              </td>
              <td>
                <BlockLink n={t.block} />
              </td>
              <td>
                <Addr a={t.from} self={self} />
              </td>
              <td>
                <Addr a={t.to} self={self} />
              </td>
              <td>{t.standard === "ERC-721" ? `#${t.value}` : tokenAmount(t.value, meta.get(t.token)).replace(/ \S+$/, "")}</td>
              <td>
                <Addr a={t.token} /> <span className="g4-dim">{meta.get(t.token)?.symbol ?? t.standard}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── /l2/bridge ─────────────────────────────────────────────────────────────

const STAGE_TEXT: Record<WithdrawalStage, { label: string; pill: string; help: string }> = {
  initiated: { label: "Initiated", pill: "pill warn", help: "On the L2 only: no settlement accepted on the L1 includes it yet." },
  settled: { label: "Settled", pill: "pill brass", help: "In the L1's accepted withdrawal tree; waiting for the claim delay and L1 finality." },
  claimable: { label: "Claimable", pill: "pill ok", help: "In the newest root a claim may prove against in the next L1 block (large claims wait longer)." },
  claimed: { label: "Claimed", pill: "pill quiet", help: "Paid out on the L1: its nullifier is set." },
};

function WithdrawalsTable({ rows, rec }: { rows: Withdrawal[]; rec: L2SettlementRecord | null }) {
  if (rows.length === 0) return <p className="g4-dim">No withdrawals in the settled L2 blocks.</p>;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>Stage on the L1</th>
            <th>Amount</th>
            <th>From (L2)</th>
            <th>To (L1 owner script hash)</th>
            <th>L2 transaction</th>
            <th>Block</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => {
            const st = STAGE_TEXT[withdrawalStage(w.nonce, rec)];
            return (
              <tr key={w.nonce}>
                <td>{fmtInt(w.nonce)}</td>
                <td>
                  <span className={st.pill + " pill-sm"} title={st.help}>
                    {st.label}
                  </span>
                </td>
                <td>{fmtNative(w.amountWei)}</td>
                <td>
                  <Addr a={w.sender} />
                </td>
                <td>
                  <code title={w.l1Recipient}>{short(w.l1Recipient, 10, 8)}</code>
                </td>
                <td>
                  <TxLink h={w.txHash} />
                </td>
                <td>
                  <BlockLink n={w.block} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function L2BridgePage() {
  const hs = useHead();
  const ls = useL2Status();
  const rec = ls.status?.record ?? null;
  const settledTop = hs.head?.head ?? null;
  const wd = useLoad(async () => (settledTop === null ? null : readWithdrawals()), [settledTop, hs.head?.rewinds ?? 0]);
  const w = rec?.withdrawals;
  return (
    <Shell
      title="Deposits and withdrawals"
      lede={
        <>
          BLCH moves between the L1 and the L2 through the L1 escrow. A <b>deposit</b> locks BLCH in the escrow on the L1; the next
          accepted settlement mints it on the L2. A <b>withdrawal</b> is an L2 call to the outbox <Addr a={OUTBOX} />; once a settlement
          carrying it is accepted and its L1 block is finalized, the owner claims it from the escrow on the L1.
        </>
      }
    >
      <LiveState ls={ls} hs={hs} />
      {!ls.status && (ls.error ? <Failure error={`L1 settlement record: ${ls.error}`} /> : <Loading />)}
      {ls.status && !rec && <p>The L1 reports no installed L2.</p>}
      {rec && w && (
        <>
          <section className="card">
            <h2 className="snap-h2">Deposits (L1 → L2)</h2>
            <KV
              rows={[
                ["Deposits admitted", rec.depositsEnabled ? <span className="pill ok pill-sm">yes</span> : <span className="pill quiet pill-sm">no</span>],
                ["Escrow balance on the L1", fmtSats(rec.inbox.escrowSat)],
                ["Deposits in the inbox", fmtInt(rec.inbox.count ?? 0)],
                ["Minted on the L2", <>{fmtInt(rec.inbox.consumed ?? 0)} <span className="g4-dim">(consumed by accepted settlements)</span></>],
                [
                  "Waiting for the next settlement",
                  <>
                    {fmtInt(rec.source?.pending.length ?? 0)}{" "}
                    {rec.source && <span className="g4-dim">(inbox positions {fmtInt(rec.source.consumedStart ?? 0)} to {fmtInt(rec.source.consumedEnd ?? 0)})</span>}
                  </>,
                ],
                ...(rec.accepted?.statement
                  ? ([
                      [
                        "Latest settlement minted",
                        `${fmtInt(rec.accepted.statement.consumedEnd - rec.accepted.statement.consumedStart)} deposits (inbox ${fmtInt(rec.accepted.statement.consumedStart)} to ${fmtInt(rec.accepted.statement.consumedEnd)}) in L2 block ${fmtInt(rec.accepted.statement.l2Number)}`,
                      ],
                    ] as [string, ReactNode][])
                  : []),
              ]}
            />
            {rec.source && rec.source.pending.length > 0 && (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>L1 height</th>
                      <th>L1 transaction</th>
                      <th>Output</th>
                      <th>Amount</th>
                      <th>L2 recipient</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rec.source.pending.map((p) => (
                      <tr key={p.txid + ":" + p.vout}>
                        <td>{fmtInt(p.height)}</td>
                        <td>
                          <Link className="mono-link" to={`/tx/${p.txid}`} title={p.txid}>
                            {short(p.txid, 10, 8)}
                          </Link>
                        </td>
                        <td>{p.vout}</td>
                        <td>{fmtSats(p.sats)}</td>
                        <td>{/^(0x)?[0-9a-fA-F]{40}$/.test(p.recipient) ? <Addr a={p.recipient.startsWith("0x") ? p.recipient : "0x" + p.recipient} /> : <code>{p.recipient}</code>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="g4-dim">
              Minted deposits are protocol credits, not L2 transactions: they change the recipient's balance in the settled block and carry no
              transaction hash. The L1 keeps only the deposits still waiting; this page does not index the history of minted ones.
            </p>
          </section>

          <section className="card">
            <h2 className="snap-h2">Withdrawal claims (L2 → L1)</h2>
            <KV
              rows={[
                ["Withdrawals settled", <>{fmtInt(w.count ?? 0)} <span className="g4-dim">root</span> <Hash h={w.root} /></>],
                ["Claimed on the L1", <>{fmtInt(w.claimedCount ?? 0)} <span className="g4-dim">· released {fmtSats(w.releasedSat)}</span></>],
                ["Claimable now (small claims)", w.claimable ? `leaves 0 to ${fmtInt(w.claimable.count - 1)} (L2 block ${fmtInt(w.claimable.l2Number)})` : "none"],
                ["Claimable now (large claims)", w.claimableLarge ? `leaves 0 to ${fmtInt(w.claimableLarge.count - 1)} (L2 block ${fmtInt(w.claimableLarge.l2Number)})` : "none"],
                ["Claim delay", w.delayBlocks !== null ? `${fmtInt(w.delayBlocks)} L1 blocks, and the settlement's L1 block must be FFG-finalized` : "not reported"],
                ["Large claims", w.largeClaimSat ? `${fmtSats(w.largeClaimSat)} or more wait ${fmtInt(w.largeDelayBlocks ?? 0)} L1 blocks` : "not reported"],
                [
                  "Release window",
                  w.releaseWindow
                    ? `${fmtSats(w.releaseWindow.capSat)} cap per ${fmtInt(w.releaseWindow.blocks ?? 0)} L1 blocks (${((w.releaseWindow.bps ?? 0) / 100).toFixed(2)}% of escrow, floor applies); ${fmtSats(w.releaseWindow.remainingSat)} remaining in this window`
                    : "not reported",
                ],
                [
                  "Attestor set",
                  w.attestorSet ? (
                    <>
                      <Hash h={w.attestorSet} n={12} /> <span className="g4-dim">signatures required for claims of {fmtSats(w.attestedClaimSat)} or more</span>
                    </>
                  ) : (
                    "none"
                  ),
                ],
                [
                  "L1 checkpoint claims rely on",
                  w.finalizedCheckpoint ? (
                    <>
                      epoch {w.finalizedCheckpoint.epoch !== null ? fmtInt(w.finalizedCheckpoint.epoch) : "?"} <Hash h={w.finalizedCheckpoint.root} />
                      {w.finalizedCheckpoint.ownRuleActive ? <span className="g4-dim"> · own-chain rule active</span> : <span className="g4-dim"> · own-chain rule not yet active</span>}
                    </>
                  ) : (
                    "not reported"
                  ),
                ],
              ]}
            />
            {w.records.length > 0 && (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>L2 block</th>
                      <th>Leaves</th>
                      <th>Root</th>
                      <th>L1 height</th>
                      <th>Finalized for claims</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.records.map((r) => (
                      <tr key={r.l2Number}>
                        <td>
                          <BlockLink n={r.l2Number} />
                        </td>
                        <td>{fmtInt(r.count)}</td>
                        <td>
                          <Hash h={r.root} />
                        </td>
                        <td>{fmtInt(r.height)}</td>
                        <td>{r.finalized ? <LevelPill level="finalized" /> : <LevelPill level="safe" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      <section className="card">
        <h2 className="snap-h2">Withdrawals initiated on the L2</h2>
        {settledTop === null ? (
          hs.error ? (
            <p className="g4-dim">The L2 RPC is not reachable, so the outbox events cannot be listed. The L1 counts above are current.</p>
          ) : (
            <Loading />
          )
        ) : wd.error ? (
          <Failure error={wd.error} onRetry={wd.reload} />
        ) : !wd.data ? (
          <Loading />
        ) : (
          <WithdrawalsTable rows={wd.data.slice(0, 200)} rec={rec} />
        )}
        {wd.data && wd.data.length > 200 && <p className="g4-dim">{fmtInt(wd.data.length)} withdrawals; the latest 200 shown.</p>}
      </section>
    </Shell>
  );
}

function AddressWithdrawals({ address, settledTop, rewinds }: { address: string; settledTop: number | null; rewinds: number }) {
  const ls = useL2Status();
  const wd = useLoad(async () => (settledTop === null ? null : (await readWithdrawals()).filter((w) => w.sender === address)), [address, settledTop, rewinds]);
  if (!wd.data || wd.data.length === 0) return null;
  return (
    <section className="card">
      <h2 className="snap-h2">Withdrawals to the L1</h2>
      <WithdrawalsTable rows={wd.data} rec={ls.status?.record ?? null} />
    </section>
  );
}
