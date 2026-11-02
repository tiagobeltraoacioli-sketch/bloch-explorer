// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bloch L2 (EVM, chain id 700770): the client and the pure decoding used by the
// /l2 pages. Every read goes through the same-origin /l2rpc endpoint (see
// edge/l2rpc.js), which forwards allowlisted read calls to the public L2 RPC.
//
// Finality is the L2 RPC's own: `latest` (executed by the sequencer),
// `safe` (its settlement is accepted at the head of the operator's L1 node) and
// `finalized` (its settlement lies in an FFG-finalized L1 block, verified by
// replaying the L1 from genesis). These pages display those tags; they never
// promote a block to a stronger level than the RPC reports.
//
// Settled-only: the explorer shows blocks, transactions, receipts, logs and
// state at or below the RPC's `safe` block only (the /l2rpc edge enforces the
// same bound; see edge/l2rpc.js). A block the sequencer executed but whose
// settlement the L1 has not accepted is not shown.

export const L2_CHAIN_ID = 700770;
export const NATIVE_SYMBOL = "BLCH";
export const NATIVE_DECIMALS = 18;

/** keccak256("Transfer(address,address,uint256)") — ERC-20 and ERC-721. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** The public L2 RPC for wallets (shown on the pages; config-driven at build time). */
export function publicRpcUrl(): string {
  let env: { VITE_L2_PUBLIC_RPC_URL?: string } | undefined;
  try {
    env = (import.meta as unknown as { env?: { VITE_L2_PUBLIC_RPC_URL?: string } }).env;
  } catch {
    env = undefined;
  }
  return env?.VITE_L2_PUBLIC_RPC_URL || "https://l2rpc.blochl1.com/";
}

/** Error code /l2rpc uses for a read above the settled bound. */
export const NOT_SETTLED = -32001;

/** System contracts of the Bloch L2 (bloch-l2-evm src/chainspec.rs, src/withdrawal.rs). */
export const PREDEPLOYS: Record<string, string> = {
  "0x4200000000000000000000000000000000000011": "Sequencer fee vault",
  "0x4200000000000000000000000000000000000019": "Base fee vault",
  "0x4200000000000000000000000000000000000100": "Supply ledger",
  "0x4200000000000000000000000000000000000101": "Block info",
  "0x4200000000000000000000000000000000000102": "L2-to-L1 message passer (withdrawals)",
  "0x000f3df6d732807ef1319fb7b8bb8522d0beac02": "Beacon roots (EIP-4788)",
};

export function predeployLabel(addr: string | null | undefined): string | null {
  return addr ? PREDEPLOYS[addr.toLowerCase()] ?? null : null;
}

// ─── transport ──────────────────────────────────────────────────────────────

type Env = { VITE_L2_RPC_URL?: string };
function endpoint(): string {
  let env: Env | undefined;
  try {
    env = (import.meta as unknown as { env?: Env }).env;
  } catch {
    env = undefined;
  }
  return env?.VITE_L2_RPC_URL || "/l2rpc";
}

export class L2RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Call {
  method: string;
  params?: unknown[];
}

type Answer = { id: number; result?: unknown; error?: { code: number; message: string } };

/**
 * One batch round trip. Each element of the result is either the call's
 * result or an L2RpcError (never thrown per call, so a batch can mix
 * answers and refusals). A transport failure throws.
 */
export async function l2Batch(calls: Call[], fetchImpl: typeof fetch = fetch): Promise<(unknown | L2RpcError)[]> {
  if (calls.length === 0) return [];
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params ?? [] }));
  const res = await fetchImpl(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new L2RpcError(-32700, `L2 RPC answered HTTP ${res.status} without JSON`);
  }
  if (!Array.isArray(parsed)) {
    const e = (parsed as Answer)?.error;
    throw new L2RpcError(e?.code ?? -32603, e?.message ?? `L2 RPC answered HTTP ${res.status}`);
  }
  const byId = new Map((parsed as Answer[]).map((a) => [a.id, a]));
  return calls.map((_, i) => {
    const a = byId.get(i);
    if (!a) return new L2RpcError(-32603, "no answer");
    if (a.error) return new L2RpcError(a.error.code, a.error.message);
    return a.result ?? null;
  });
}

/** Batched calls, split into chunks the endpoint accepts. */
export async function l2BatchAll(calls: Call[], chunk = 100, fetchImpl: typeof fetch = fetch) {
  const out: (unknown | L2RpcError)[] = [];
  for (let i = 0; i < calls.length; i += chunk) out.push(...(await l2Batch(calls.slice(i, i + chunk), fetchImpl)));
  return out;
}

export async function l2Call<T>(method: string, params: unknown[] = [], fetchImpl: typeof fetch = fetch): Promise<T> {
  const [r] = await l2Batch([{ method, params }], fetchImpl);
  if (r instanceof L2RpcError) throw r;
  return r as T;
}

/** Unwrap a batch element, throwing its error. */
export function ok<T>(r: unknown): T {
  if (r instanceof L2RpcError) throw r;
  return r as T;
}

// ─── shapes ─────────────────────────────────────────────────────────────────

export interface L2Tx {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  nonce: string;
  gas: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  input: string;
  type: string;
  blockNumber: string | null;
  blockHash: string | null;
  transactionIndex: string | null;
}

export interface L2Log {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  blockTimestamp?: string;
}

export interface L2Receipt {
  transactionHash: string;
  status: string;
  gasUsed: string;
  effectiveGasPrice: string;
  contractAddress: string | null;
  logs: L2Log[];
  from: string;
  to: string | null;
  blockNumber: string;
}

export interface L2Block {
  hash: string;
  number: string;
  parentHash: string;
  timestamp: string;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas?: string;
  miner: string;
  stateRoot: string;
  anchorRoot?: string;
  depositsHash?: string;
  size?: string;
  transactions: (L2Tx | string)[];
}

export interface FinalityLevels {
  latest: number | null;
  safe: number | null;
  finalized: number | null;
  l1FinalizedEpoch: number | null;
  l1FinalizedSlot: number | null;
  l1FinalizedRoot: string | null;
  safeCommitment: string | null;
  safeL2Number: number | null;
  trust: string | null;
  /** The follower verified the L1 block that installed this L2 genesis as FFG-final. */
  genesisFinalized: boolean | null;
  verifiedL1Blocks: number | null;
}

/** Per-block settlement location, from `bloch_settlement` when served. */
export interface Settlement {
  l2Number: number;
  l2Hash: string | null;
  commitment: string | null;
  l1Slot: number | null;
  l1Block: string | null;
}

// ─── numbers ────────────────────────────────────────────────────────────────

export function hexBig(h: string | null | undefined): bigint {
  if (typeof h !== "string" || !/^0x[0-9a-fA-F]*$/.test(h)) return 0n;
  return h === "0x" ? 0n : BigInt(h);
}

export function hexNum(h: string | null | undefined): number {
  return Number(hexBig(h));
}

/** Integer-exact unit formatting: `fmtUnits(1500000000000000000n, 18) === "1.5"`. */
export function fmtUnits(v: bigint, decimals: number, maxFrac = 6): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = decimals > 0 ? (a % base).toString().padStart(decimals, "0") : "";
  if (frac.length > maxFrac) frac = frac.slice(0, maxFrac);
  frac = frac.replace(/0+$/, "");
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = neg ? "-" : "";
  // A non-zero amount below the shown precision is not printed as zero.
  if (a > 0n && whole === 0n && !frac) return sign + "<0." + "0".repeat(Math.max(0, maxFrac - 1)) + "1";
  return sign + w + (frac ? "." + frac : "");
}

export function fmtNative(wei: bigint, maxFrac = 6): string {
  return `${fmtUnits(wei, NATIVE_DECIMALS, maxFrac)} ${NATIVE_SYMBOL}`;
}

export function fmtGwei(wei: bigint): string {
  return `${fmtUnits(wei, 9, 4)} gwei`;
}

// ─── finality ───────────────────────────────────────────────────────────────

export type Level = "finalized" | "safe" | "latest" | "unknown";

export function parseFinality(raw: unknown, latestNumber?: number | null): FinalityLevels {
  const r = (raw ?? {}) as Record<string, any>;
  const lvl = (k: string) => (r[k] && typeof r[k].number === "string" ? hexNum(r[k].number) : null);
  const l1 = r.l1 ?? {};
  const fin = l1.finalized ?? {};
  const ss = l1.safe_settlement ?? null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    latest: lvl("latest") ?? latestNumber ?? null,
    safe: lvl("safe"),
    finalized: lvl("finalized"),
    l1FinalizedEpoch: num(fin.epoch),
    l1FinalizedSlot: num(fin.slot),
    l1FinalizedRoot: typeof fin.root === "string" ? fin.root : null,
    safeCommitment: ss && typeof ss.commitment === "string" ? ss.commitment : null,
    safeL2Number: ss ? num(ss.l2_number) : null,
    trust: typeof r.trust === "string" ? r.trust : null,
    genesisFinalized: r.l2_genesis && typeof r.l2_genesis.finalized === "boolean" ? r.l2_genesis.finalized : null,
    verifiedL1Blocks: num(l1.verified_blocks),
  };
}

/** The strongest level the RPC reports for block `n`. Never stronger. */
export function levelOf(n: number, f: FinalityLevels | null): Level {
  if (!f) return "unknown";
  if (f.finalized !== null && n <= f.finalized) return "finalized";
  if (f.safe !== null && n <= f.safe) return "safe";
  if (f.latest !== null && n <= f.latest) return "latest";
  return "unknown";
}

export const LEVEL_TEXT: Record<Level, { label: string; pill: string; help: string }> = {
  finalized: {
    label: "Finalized",
    pill: "pill ok",
    help: "Its settlement is in an L1 block finalized by FFG, verified by replaying the L1 from genesis.",
  },
  safe: {
    label: "Safe",
    pill: "pill brass",
    help: "Its settlement is accepted at the head of the L1; not yet in an FFG-finalized L1 block.",
  },
  latest: {
    label: "Latest",
    pill: "pill warn",
    help: "Executed by the sequencer; its settlement is not yet accepted on the L1.",
  },
  unknown: { label: "Unknown", pill: "pill quiet", help: "The L2 RPC did not report a level for this block." },
};

export function parseSettlement(raw: unknown): Settlement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const n = typeof r.l2_number === "number" ? r.l2_number : typeof r.l2_number === "string" ? hexNum(r.l2_number) : NaN;
  if (!Number.isFinite(n)) return null;
  const h = (v: unknown) => (typeof v === "string" && /^(0x)?[0-9a-fA-F]{64}$/.test(v) ? v.replace(/^0x/, "").toLowerCase() : null);
  return {
    l2Number: n,
    l2Hash: h(r.l2_hash),
    commitment: h(r.commitment),
    l1Slot: typeof r.native_slot === "number" ? r.native_slot : null,
    l1Block: h(r.native_block),
  };
}

// ─── logs ───────────────────────────────────────────────────────────────────

export interface TokenTransfer {
  standard: "ERC-20" | "ERC-721";
  token: string;
  from: string;
  to: string;
  /** Amount (ERC-20) or token id (ERC-721). */
  value: bigint;
  txHash: string;
  block: number;
  logIndex: number;
}

const topicAddr = (t: string) => "0x" + t.slice(26).toLowerCase();

export function addrTopic(addr: string): string {
  return "0x" + "0".repeat(24) + addr.toLowerCase().replace(/^0x/, "");
}

/** Decode a Transfer log, or null if the log is not a well-formed one. */
export function decodeTransfer(log: L2Log): TokenTransfer | null {
  if (!log || !Array.isArray(log.topics) || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return null;
  const base = {
    token: log.address.toLowerCase(),
    txHash: log.transactionHash,
    block: hexNum(log.blockNumber),
    logIndex: hexNum(log.logIndex),
  };
  const word = /^0x[0-9a-fA-F]{64}$/;
  if (log.topics.length === 3 && word.test(log.data)) {
    return { standard: "ERC-20", from: topicAddr(log.topics[1]), to: topicAddr(log.topics[2]), value: hexBig(log.data), ...base };
  }
  if (log.topics.length === 4 && (log.data === "0x" || log.data === "")) {
    return { standard: "ERC-721", from: topicAddr(log.topics[1]), to: topicAddr(log.topics[2]), value: hexBig(log.topics[3]), ...base };
  }
  return null;
}

/** Decode an ABI `string` return, or a `bytes32` one (old tokens). */
export function decodeAbiString(hex: unknown): string | null {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 66) return null;
  const body = hex.slice(2);
  const bytesToText = (h: string) => {
    const bytes = new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  };
  if (body.length >= 128) {
    const off = Number(BigInt("0x" + body.slice(0, 64)));
    if (off === 32 && body.length >= 128) {
      const len = Number(BigInt("0x" + body.slice(64, 128)));
      if (len <= 256 && body.length >= 128 + len * 2) {
        const s = len === 0 ? "" : bytesToText(body.slice(128, 128 + len * 2));
        return s === null ? null : sanitize(s);
      }
    }
  }
  if (body.length === 64) {
    const s = bytesToText(body.replace(/(00)+$/, ""));
    return s === null ? null : sanitize(s);
  }
  return null;
}

function sanitize(s: string): string {
  // Token metadata is attacker-chosen: no control characters, bounded length.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").slice(0, 64);
}

// ─── inputs ─────────────────────────────────────────────────────────────────

export type SearchTarget =
  | { kind: "block"; number: number }
  | { kind: "hash"; hash: string }
  | { kind: "address"; address: string }
  | { kind: "none" };

/** Classify what a person typed into the L2 search box. */
export function classifyQuery(q: string): SearchTarget {
  const s = q.trim();
  if (/^\d{1,15}$/.test(s)) return { kind: "block", number: Number(s) };
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return { kind: "hash", hash: s.toLowerCase() };
  if (/^[0-9a-fA-F]{64}$/.test(s)) return { kind: "hash", hash: "0x" + s.toLowerCase() };
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { kind: "address", address: s.toLowerCase() };
  return { kind: "none" };
}

export const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
export const isHash32 = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);

/** Known 4-byte selectors worth naming in a transaction's input. */
export const SELECTORS: Record<string, string> = {
  "0xa9059cbb": "transfer(address,uint256)",
  "0x095ea7b3": "approve(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0xd0e30db0": "deposit()",
  "0x2e1a7d4d": "withdraw(uint256)",
  "0xb769844a": "initiateWithdrawal(bytes32)",
};

export function methodOf(input: string | null | undefined): string {
  if (!input || input === "0x") return "Transfer";
  const sel = input.slice(0, 10).toLowerCase();
  return SELECTORS[sel] ?? sel;
}

export function txFee(r: Pick<L2Receipt, "gasUsed" | "effectiveGasPrice">): bigint {
  return hexBig(r.gasUsed) * hexBig(r.effectiveGasPrice);
}

export function txStatus(r: Pick<L2Receipt, "status"> | null | undefined): "success" | "failed" | "pending" {
  if (!r) return "pending";
  return hexNum(r.status) === 1 ? "success" : "failed";
}

// ─── reads used by several pages ────────────────────────────────────────────

export interface Head {
  /** The newest block the explorer shows: the RPC's `safe` block (null: nothing settled yet). */
  head: number | null;
  chainId: number;
  finality: FinalityLevels;
  finalityServed: boolean;
}

/** The settled bound: `safe`, else `finalized`, else null. Never `latest`. */
export function settledTip(f: FinalityLevels | null): number | null {
  if (!f) return null;
  return f.safe ?? f.finalized ?? null;
}

/**
 * Settled head and finality levels in one round trip. The head is the
 * `safe` block, not the sequencer's latest one.
 */
export async function readHead(fetchImpl: typeof fetch = fetch): Promise<Head> {
  const [fin, cid, s, f] = await l2Batch(
    [
      { method: "bloch_finality" },
      { method: "eth_chainId" },
      { method: "eth_getBlockByNumber", params: ["safe", false] },
      { method: "eth_getBlockByNumber", params: ["finalized", false] },
    ],
    fetchImpl,
  );
  const chainId = hexNum(ok<string>(cid));
  const n = (b: unknown) => (b && !(b instanceof L2RpcError) ? hexNum((b as L2Block).number) : null);
  const tags = { safe: n(s), finalized: n(f) };
  const served = !(fin instanceof L2RpcError) && fin !== null;
  // The tags the RPC serves are the bound; bloch_finality adds the L1 anchors.
  const finality = served ? { ...parseFinality(fin), ...tags } : { ...parseFinality(null), ...tags };
  return { head: settledTip(finality), chainId, finality, finalityServed: served };
}

/** Optional per-block settlement location; null when the RPC does not serve it. */
export async function readSettlement(n: number, fetchImpl: typeof fetch = fetch): Promise<Settlement | null> {
  try {
    const r = await l2Call<unknown>("bloch_settlement", ["0x" + n.toString(16)], fetchImpl);
    return parseSettlement(r);
  } catch {
    return null;
  }
}

export interface AddressScan {
  from: number;
  to: number;
  txs: { tx: L2Tx; timestamp: number }[];
}

/**
 * Native transactions to or from `addr` in blocks [from, to], newest first.
 * The L2 RPC has no address index, so this reads the blocks; the pages say
 * which range was read.
 */
export async function scanAddressTxs(addr: string, from: number, to: number, fetchImpl: typeof fetch = fetch): Promise<AddressScan> {
  const a = addr.toLowerCase();
  const calls: Call[] = [];
  for (let n = to; n >= from; n--) calls.push({ method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), true] });
  const blocks = await l2BatchAll(calls, 100, fetchImpl);
  const txs: AddressScan["txs"] = [];
  for (const b of blocks) {
    const blk = ok<L2Block | null>(b);
    if (!blk) continue;
    for (const t of blk.transactions) {
      if (typeof t === "string") continue;
      if (t.from?.toLowerCase() === a || t.to?.toLowerCase() === a) txs.push({ tx: t, timestamp: hexNum(blk.timestamp) });
    }
  }
  return { from, to, txs };
}

/** ERC-20/721 transfers touching `addr` (all history, via eth_getLogs). */
export async function readAddressTransfers(addr: string, fetchImpl: typeof fetch = fetch): Promise<TokenTransfer[]> {
  const t = addrTopic(addr);
  const filter = (topics: (string | null)[]) => ({ method: "eth_getLogs", params: [{ fromBlock: "0x0", toBlock: "safe", topics }] });
  const [out, inn] = await l2Batch([filter([TRANSFER_TOPIC, t]), filter([TRANSFER_TOPIC, null, t])], fetchImpl);
  const seen = new Set<string>();
  const all: TokenTransfer[] = [];
  for (const logs of [ok<L2Log[]>(out), ok<L2Log[]>(inn)]) {
    for (const l of logs ?? []) {
      const d = decodeTransfer(l);
      if (!d) continue;
      const k = d.txHash + ":" + d.logIndex;
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(d);
    }
  }
  return all.sort((x, y) => y.block - x.block || y.logIndex - x.logIndex);
}

export interface TokenMeta {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
}

export async function readTokenMeta(addrs: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, TokenMeta>> {
  const calls: Call[] = [];
  for (const a of addrs) {
    for (const data of ["0x06fdde03", "0x95d89b41", "0x313ce567", "0x18160ddd"]) calls.push({ method: "eth_call", params: [{ to: a, data }, "safe"] });
  }
  const rs = await l2BatchAll(calls, 100, fetchImpl);
  const out = new Map<string, TokenMeta>();
  addrs.forEach((a, i) => {
    const [n, s, d, t] = rs.slice(i * 4, i * 4 + 4).map((r) => (r instanceof L2RpcError ? null : (r as string)));
    const dec = d && /^0x[0-9a-fA-F]{64}$/.test(d) ? Number(hexBig(d)) : null;
    out.set(a.toLowerCase(), {
      address: a.toLowerCase(),
      name: decodeAbiString(n),
      symbol: decodeAbiString(s),
      decimals: dec !== null && dec <= 77 ? dec : null,
      totalSupply: t && /^0x[0-9a-fA-F]{64}$/.test(t) ? hexBig(t) : null,
    });
  });
  return out;
}

export async function readTokenBalances(owner: string, tokens: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, bigint | null>> {
  const data = "0x70a08231" + "0".repeat(24) + owner.toLowerCase().replace(/^0x/, "");
  const rs = await l2BatchAll(tokens.map((t) => ({ method: "eth_call", params: [{ to: t, data }, "safe"] })), 100, fetchImpl);
  const out = new Map<string, bigint | null>();
  tokens.forEach((t, i) => {
    const r = rs[i];
    out.set(t.toLowerCase(), typeof r === "string" && /^0x[0-9a-fA-F]{64}$/.test(r) ? hexBig(r) : null);
  });
  return out;
}

export function tokenAmount(v: bigint, meta: TokenMeta | undefined): string {
  if (!meta || meta.decimals === null) return v.toString();
  return fmtUnits(v, meta.decimals, 6) + (meta.symbol ? " " + meta.symbol : "");
}

// ─── withdrawals (L2 → L1 outbox) ───────────────────────────────────────────

/** The outbox predeploy (bloch-l2-evm src/withdrawal.rs). */
export const OUTBOX = "0x4200000000000000000000000000000000000102";
/** keccak256("WithdrawalInitiated(uint256,bytes32,address,uint256)"). */
export const WITHDRAWAL_INITIATED_TOPIC = "0xce2e3b3c3607f63db6a4e9c3d50ce0b37e10456bce8dcb9b5d9cecd1c28a69d2";

export interface Withdrawal {
  nonce: number;
  /** The L1 owner script hash the claim pays (32 bytes, hex without 0x). */
  l1Recipient: string;
  sender: string;
  amountWei: bigint;
  txHash: string;
  block: number;
}

/** Decode an outbox `WithdrawalInitiated` log, or null. */
export function decodeWithdrawal(log: L2Log): Withdrawal | null {
  if (!log || log.address?.toLowerCase() !== OUTBOX || !Array.isArray(log.topics) || log.topics.length !== 3) return null;
  if (log.topics[0]?.toLowerCase() !== WITHDRAWAL_INITIATED_TOPIC) return null;
  if (!/^0x[0-9a-fA-F]{128}$/.test(log.data) || !/^0x0{24}/.test(log.data)) return null;
  const nonce = hexBig(log.topics[1]);
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return {
    nonce: Number(nonce),
    l1Recipient: log.topics[2].slice(2).toLowerCase(),
    sender: "0x" + log.data.slice(26, 66).toLowerCase(),
    amountWei: hexBig("0x" + log.data.slice(66)),
    txHash: log.transactionHash,
    block: hexNum(log.blockNumber),
  };
}

/** Settled withdrawals (newest first), optionally only those sent by `sender`. */
export async function readWithdrawals(fetchImpl: typeof fetch = fetch): Promise<Withdrawal[]> {
  const logs = await l2Call<L2Log[]>("eth_getLogs", [{ fromBlock: "0x0", toBlock: "safe", address: OUTBOX, topics: [WITHDRAWAL_INITIATED_TOPIC] }], fetchImpl);
  return (logs ?? []).map(decodeWithdrawal).filter((w): w is Withdrawal => !!w).sort((a, b) => b.nonce - a.nonce);
}
