// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Bloch L2 explorer (EVM, chain id 700770): /l2, /l2/blocks/:from,
// /l2/block/:id, /l2/tx/:hash, /l2/address/:addr.
//
// Every value on these pages is read from the public L2 RPC through /l2rpc.
// There is no indexer: blocks, transactions and receipts are direct reads;
// token transfers come from eth_getLogs over the whole chain; native
// transactions of an address are found by reading a stated range of blocks.
// Finality badges show the L2 RPC's own `latest` / `safe` / `finalized` tags.

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "../lib/router";
import { Copyable, KV } from "../components/ui";
import { fmtInt, fmtTime, timeAgo, short } from "../lib/format";
import { pollWhileVisible } from "../lib/polling";
import {
  FinalityLevels,
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
  L2_CHAIN_ID,
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
  const [head, setHead] = useState<{ head: number; chainId: number; finality: FinalityLevels; finalityServed: boolean; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      pollWhileVisible(async () => {
        try {
          const h = await readHead();
          servedChainId = h.chainId;
          setHead({ ...h, at: Date.now() });
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

function FinalityStrip({ head, error }: ReturnType<typeof useHead>) {
  if (!head && error) return <Failure error={error} />;
  if (!head) return <Loading />;
  const f = head.finality;
  return (
    <div className="g4-grid card l2-finality">
      <div className="g4-stat">
        <span className="g4-k">Latest block</span>
        <span className="g4-v">
          <BlockLink n={head.head} />
        </span>
        <span className="g4-dim">executed by the sequencer</span>
      </div>
      <div className="g4-stat">
        <span className="g4-k">Safe</span>
        <span className="g4-v">{f.safe === null ? "none yet" : <BlockLink n={f.safe} />}</span>
        <span className="g4-dim">settlement accepted at the L1 head</span>
      </div>
      <div className="g4-stat">
        <span className="g4-k">Finalized</span>
        <span className="g4-v">{f.finalized === null ? "none yet" : <BlockLink n={f.finalized} />}</span>
        <span className="g4-dim">settlement in an FFG-finalized L1 block</span>
      </div>
      <div className="g4-stat">
        <span className="g4-k">L1 finalized checkpoint</span>
        <span className="g4-v">
          {f.l1FinalizedSlot !== null ? <Link to={`/slot/${f.l1FinalizedSlot}`}>slot {fmtInt(f.l1FinalizedSlot)}</Link> : "not reported"}
        </span>
        <span className="g4-dim">{f.l1FinalizedEpoch !== null ? `epoch ${fmtInt(f.l1FinalizedEpoch)}` : head.finalityServed ? "" : "bloch_finality not served"}</span>
      </div>
    </div>
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
  const top = hs.head?.head ?? null;
  const data = useLoad(async () => (top === null ? null : readBlocks(top, PAGE)), [top]);
  const txRows = useMemo(() => {
    if (!data.data) return [];
    const rows: { tx: L2Tx; timestamp: number }[] = [];
    for (const b of data.data.blocks) for (const t of b.transactions) if (typeof t !== "string") rows.push({ tx: t, timestamp: hexNum(b.timestamp) });
    return rows.slice(0, PAGE);
  }, [data.data]);
  return (
    <Shell
      title="Bloch L2 explorer"
      lede={
        <>
          The Bloch L2 is an EVM rollup settled on the Bloch L1. Each L2 block is proven and settled in an L1 block; a block is
          shown as <b>Finalized</b> only once its settlement is in an FFG-finalized L1 block. Native currency: bridged BLCH (18
          decimals).
        </>
      }
    >
      <FinalityStrip {...hs} />
      <section className="card">
        <h2 className="snap-h2">Latest blocks</h2>
        {data.error ? <Failure error={data.error} onRetry={data.reload} /> : !data.data ? <Loading /> : <BlocksTable blocks={data.data.blocks} finality={hs.head?.finality ?? null} />}
        {top !== null && top >= PAGE && (
          <p>
            <Link to={`/l2/blocks/${top - PAGE}`}>Older blocks</Link>
          </p>
        )}
      </section>
      <section className="card">
        <h2 className="snap-h2">Transactions in these blocks</h2>
        {data.data ? <TxTable rows={txRows} receipts={data.data.receipts} /> : null}
        {data.data && data.data.blocks.length > 0 && (
          <p className="g4-dim">
            From blocks {fmtInt(hexNum(data.data.blocks[data.data.blocks.length - 1].number))} to {fmtInt(hexNum(data.data.blocks[0].number))}.
          </p>
        )}
      </section>
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
        {hs.head && from + PAGE <= hs.head.head ? <Link to={`/l2/blocks/${from + PAGE}`}>Newer</Link> : <Link to="/l2">Latest</Link>}
        {from - PAGE >= 0 && <Link to={`/l2/blocks/${from - PAGE}`}>Older</Link>}
      </p>
    </Shell>
  );
}

// ─── /l2/block/:id ──────────────────────────────────────────────────────────

function SettlementPanel({ n, finality, settlement }: { n: number; finality: FinalityLevels | null; settlement: Settlement | null | undefined }) {
  const level = levelOf(n, finality);
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
  }, [id]);
  if (data.error) return <Shell title="L2 block"><Failure error={data.error} onRetry={data.reload} /></Shell>;
  if (data.loading && !data.data) return <Shell title="L2 block"><Loading /></Shell>;
  if (!data.data) {
    return (
      <Shell title="L2 block not found">
        <p className="page-lede">
          The L2 RPC has no block <code>{id}</code>
          {hs.head ? <> (latest is <BlockLink n={hs.head.head} />)</> : null}.
        </p>
      </Shell>
    );
  }
  const { block: b, receipts, settlement } = data.data;
  const n = hexNum(b.number);
  const txs = b.transactions.filter((t): t is L2Tx => typeof t !== "string");
  const conf = hs.head ? hs.head.head - n + 1 : null;
  return (
    <Shell title={<>L2 block {fmtInt(n)} <LevelPill level={levelOf(n, hs.head?.finality ?? null)} /></>}>
      <section className="card">
        <KV
          rows={[
            ["Block hash", <Copyable text={b.hash} />],
            ["Parent", n > 0 ? <Link className="mono-link" to={`/l2/block/${n - 1}`}>{b.parentHash}</Link> : <code>{b.parentHash}</code>],
            ["Timestamp", <>{fmtTime(hexNum(b.timestamp))} <span className="g4-dim">({timeAgo(hexNum(b.timestamp))})</span></>],
            ["Confirmations", conf === null ? "…" : fmtInt(Math.max(conf, 0))],
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
          {hs.head && n < hs.head.head && <Link to={`/l2/block/${n + 1}`}>Next block</Link>}
        </p>
      </section>
      <SettlementPanel n={n} finality={hs.head?.finality ?? null} settlement={settlement} />
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
  }, [hash]);
  if (data.error) return <Shell title="L2 transaction"><Failure error={data.error} onRetry={data.reload} /></Shell>;
  if (data.loading && !data.data) return <Shell title="L2 transaction"><Loading /></Shell>;
  if (!data.data) {
    return (
      <Shell title="L2 transaction not found">
        <p className="page-lede">
          The L2 RPC does not know <code>{hash}</code>. A transaction sent moments ago appears once the sequencer includes it in a block.
        </p>
      </Shell>
    );
  }
  const { tx, receipt, timestamp, meta } = data.data;
  const n = tx.blockNumber ? hexNum(tx.blockNumber) : null;
  const level = n === null ? "unknown" : levelOf(n, hs.head?.finality ?? null);
  const gasPrice = receipt ? hexBig(receipt.effectiveGasPrice) : hexBig(tx.gasPrice ?? tx.maxFeePerGas ?? "0x0");
  return (
    <Shell title={<>L2 transaction {n !== null && <LevelPill level={level} />}</>}>
      <section className="card">
        <KV
          rows={[
            ["Hash", <Copyable text={tx.hash} />],
            ["Status", <><StatusPill r={receipt} /> {receipt && n !== null && <span className="g4-dim">{LEVEL_TEXT[level].help}</span>}</>],
            ["Block", n === null ? "pending" : <><BlockLink n={n} /> {hs.head && <span className="g4-dim">({fmtInt(Math.max(0, hs.head.head - n + 1))} confirmations)</span>}</>],
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
      { method: "eth_getBalance", params: [a, "latest"] },
      { method: "eth_getBalance", params: [a, "finalized"] },
      { method: "eth_getTransactionCount", params: [a, "latest"] },
      { method: "eth_getCode", params: [a, "latest"] },
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
      const logs = await l2Call<L2Log[]>("eth_getLogs", [{ fromBlock: "0x0", toBlock: "latest", address: a, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] }]);
      tokenFeed = logs.map(decodeTransfer).filter((x): x is TokenTransfer => !!x).sort((x, y) => y.block - x.block || y.logIndex - x.logIndex);
    }
    return {
      balance: hexBig(ok<string>(bal)),
      finalizedBalance: fbal instanceof L2RpcError || fbal === null ? null : hexBig(fbal as string),
      nonce: hexNum(ok<string>(nonce)),
      code: typeof code === "string" ? code : "0x",
      transfers,
      meta,
      holdings,
      tokenFeed,
    };
  }, [a]);

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
            ["Balance (latest)", d ? fmtNative(d.balance, 18) : base.error ? "unavailable" : "…"],
            ["Balance (finalized)", d ? (d.finalizedBalance === null ? <span className="g4-dim">no finalized block yet</span> : fmtNative(d.finalizedBalance, 18)) : "…"],
            ["Nonce (sent transactions)", d ? fmtInt(d.nonce) : "…"],
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
