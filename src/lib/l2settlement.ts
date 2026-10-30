// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Bloch L2 settlement record as the L1 holds it (`getl2settlement`, served
// by GET /l2status with the number of agreeing L1 observers; see
// edge/l2status.js), decoded for the /l2 pages.
//
// Field meanings follow `l2_settlement_json` in bloch-pos-node (rpc.rs) and
// the statement layout in bloch-l2-evm `proof_statement.rs`
// (SettlementStatementV2/V3). Nothing here is inferred: a value the record
// does not carry is shown as not reported.

/** L1 timing (Genesis-4): 30 s slots, 32 slots per epoch. */
export const L1_GENESIS_TIME = 1786656679;
export const L1_SLOT_SECONDS = 30;
export const L1_SLOTS_PER_EPOCH = 32;
/** 1 BLCH = 10^8 sat on the L1; on the L2 it has 18 decimals (1 sat = 10^10 wei). */
export const SATS_PER_BLCH = 100_000_000n;

export const epochOfSlot = (slot: number) => Math.floor(slot / L1_SLOTS_PER_EPOCH);
export const timeOfSlot = (slot: number) => L1_GENESIS_TIME + slot * L1_SLOT_SECONDS;

export function fmtSats(raw: string | number | bigint | null | undefined): string {
  if (raw === null || raw === undefined) return "not reported";
  let v: bigint;
  try {
    v = BigInt(raw);
  } catch {
    return "not reported";
  }
  const whole = v / SATS_PER_BLCH;
  const frac = (v % SATS_PER_BLCH).toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? "." + frac : ""} BLCH`;
}

// ─── statement ──────────────────────────────────────────────────────────────

const TAG_V2 = "BLOCH:EVM:SETTLEMENT:2";
const TAG_V3 = "BLOCH:EVM:SETTLEMENT:3";
const TAG_BYTES = 22;
const V2_BYTES = 590;
const V3_BYTES = 766;

export interface Statement {
  version: 2 | 3;
  chainId: number;
  l2Number: number;
  l2ParentHash: string;
  l2HeaderHash: string;
  l2StateRoot: string;
  l1SourceBlock: string;
  l1SourceSlot: number;
  l1SourceHeight: number;
  inboxCount: number;
  consumedStart: number;
  consumedEnd: number;
  /** V3 only. */
  userTxCount: number | null;
  withdrawalRoot: string | null;
  withdrawalCount: number | null;
  daCommitment: string | null;
}

function hexToBytes(h: string): Uint8Array | null {
  const s = h.replace(/^0x/, "");
  if (!/^([0-9a-fA-F]{2})*$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Decode an accepted settlement statement (hex, as `accepted.statement`).
 * Offsets after the 22-byte tag: 8 hashes (256), chain id u64 at 256, L2
 * number u64 at 264, parent/previous-state/header/state/L1-block hashes from
 * 272, L1 slot and height u64 at 432/440, source commitment and inbox root,
 * inbox count and consumed range u64 at 512/520/528, body commitment at 536;
 * V3 then deposits hash at 568 ... withdrawal root 672, count 704, DA 712.
 */
export function decodeStatement(hex: unknown): Statement | null {
  if (typeof hex !== "string") return null;
  const b = hexToBytes(hex);
  if (!b) return null;
  const tag = new TextDecoder().decode(b.slice(0, TAG_BYTES));
  const version = b.length === V2_BYTES && tag === TAG_V2 ? 2 : b.length === V3_BYTES && tag === TAG_V3 ? 3 : null;
  if (!version) return null;
  const at = (o: number) => TAG_BYTES + o;
  const h = (o: number) => Array.from(b.slice(at(o), at(o) + 32), (x) => x.toString(16).padStart(2, "0")).join("");
  const n = (o: number) => {
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[at(o) + i]);
    return Number(v);
  };
  return {
    version,
    chainId: n(256),
    l2Number: n(264),
    l2ParentHash: h(272),
    l2HeaderHash: h(336),
    l2StateRoot: h(368),
    l1SourceBlock: h(400),
    l1SourceSlot: n(432),
    l1SourceHeight: n(440),
    inboxCount: n(512),
    consumedStart: n(520),
    consumedEnd: n(528),
    userTxCount: version === 3 ? n(664) : null,
    withdrawalRoot: version === 3 ? h(672) : null,
    withdrawalCount: version === 3 ? n(704) : null,
    daCommitment: version === 3 ? h(712) : null,
  };
}

// ─── record ─────────────────────────────────────────────────────────────────

export interface PendingDeposit {
  height: number;
  txIndex: number;
  txid: string;
  vout: number;
  sats: string;
  recipient: string;
}

export interface WithdrawalRecord {
  l2Number: number;
  root: string;
  count: number;
  height: number;
  finalized: boolean;
}

export interface L2SettlementRecord {
  chainId: number | null;
  activated: boolean;
  depositsEnabled: boolean;
  userTransactions: boolean;
  asynchronous: boolean | null;
  l1Height: number | null;
  network: string | null;
  genesis: string | null;
  /** The frozen L1 source the next settlement must use. */
  source: {
    block: string | null;
    slot: number | null;
    height: number | null;
    inboxCount: number | null;
    consumedStart: number | null;
    consumedEnd: number | null;
    pending: PendingDeposit[];
  } | null;
  inbox: { count: number | null; consumed: number | null; escrowSat: string | null };
  daRecords: { l2Number: number; commitment: string; height: number }[];
  withdrawals: {
    root: string | null;
    count: number | null;
    records: WithdrawalRecord[];
    claimable: WithdrawalRecord | null;
    claimableLarge: WithdrawalRecord | null;
    claimedCount: number | null;
    claimedFloor: number;
    claimedWords: Map<number, string>;
    delayBlocks: number | null;
    largeClaimSat: string | null;
    largeDelayBlocks: number | null;
    releaseWindow: { blocks: number | null; bps: number | null; capSat: string | null; remainingSat: string | null; releasedSat: string | null } | null;
    attestorSet: string | null;
    attestedClaimSat: string | null;
    releasedSat: string | null;
    escrowConserved: boolean | null;
    finalizedCheckpoint: { epoch: number | null; root: string | null; ownRoot: string | null; ownRuleActive: boolean | null } | null;
  };
  accepted: { commitment: string | null; statement: Statement | null; rawStatement: string | null } | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function record(v: unknown): WithdrawalRecord | null {
  const r = obj(v);
  if (!r) return null;
  const l2 = num(r.l2_number);
  const root = str(r.root);
  if (l2 === null || root === null) return null;
  return { l2Number: l2, root, count: num(r.count) ?? 0, height: num(r.height) ?? 0, finalized: r.finalized === true };
}

/** Parse the `result` of `getl2settlement` (null: no L2 installed). */
export function parseL2Settlement(raw: unknown): L2SettlementRecord | null {
  const r = obj(raw);
  if (!r) return null;
  const profile = obj(r.profile) ?? {};
  const src = obj(r.source);
  const inbox = obj(r.inbox) ?? {};
  const w = obj(r.withdrawals) ?? {};
  const claimed = obj(w.claimed) ?? {};
  const rw = obj(w.release_window);
  const fc = obj(w.finalized_checkpoint);
  const acc = obj(r.accepted);
  const words = new Map<number, string>();
  if (Array.isArray(claimed.words)) {
    for (const x of claimed.words) {
      const o = obj(x);
      if (o && typeof o.word === "number" && typeof o.bits === "string") words.set(o.word, o.bits);
    }
  }
  return {
    chainId: num(r.chain_id),
    activated: profile.activated === true,
    depositsEnabled: profile.deposits === true,
    userTransactions: profile.user_transactions === true,
    asynchronous: bool(r.asynchronous),
    l1Height: num(r.native_height),
    network: str(r.network),
    genesis: str(r.genesis),
    source: src
      ? {
          block: str(src.block),
          slot: num(src.slot),
          height: num(src.height),
          inboxCount: num(src.inbox_count),
          consumedStart: num(src.consumed_start),
          consumedEnd: num(src.consumed_end),
          pending: Array.isArray(src.pending)
            ? src.pending.map(obj).filter((p): p is Record<string, unknown> => !!p).map((p) => ({
                height: num(p.height) ?? 0,
                txIndex: num(p.tx_index) ?? 0,
                txid: str(p.txid) ?? "",
                vout: num(p.vout) ?? 0,
                sats: String(p.sats ?? "0"),
                recipient: str(p.recipient) ?? "",
              }))
            : [],
        }
      : null,
    inbox: { count: num(inbox.count), consumed: num(inbox.consumed), escrowSat: str(inbox.escrow_sat) },
    daRecords: Array.isArray(r.data_availability)
      ? r.data_availability.map(obj).filter((d): d is Record<string, unknown> => !!d).map((d) => ({
          l2Number: num(d.l2_number) ?? 0,
          commitment: str(d.commitment) ?? "",
          height: num(d.height) ?? 0,
        }))
      : [],
    withdrawals: {
      root: str(w.root),
      count: num(w.count),
      records: Array.isArray(w.roots) ? w.roots.map(record).filter((x): x is WithdrawalRecord => !!x) : [],
      claimable: record(w.claimable),
      claimableLarge: record(w.claimable_large),
      claimedCount: num(claimed.count),
      claimedFloor: num(claimed.floor) ?? 0,
      claimedWords: words,
      delayBlocks: num(w.delay_blocks),
      largeClaimSat: str(w.large_claim_sat),
      largeDelayBlocks: num(w.large_delay_blocks),
      releaseWindow: rw
        ? { blocks: num(rw.blocks), bps: num(rw.bps), capSat: str(rw.cap_sat), remainingSat: str(rw.remaining_sat), releasedSat: str(rw.released_sat) }
        : null,
      attestorSet: str(w.attestor_set),
      attestedClaimSat: str(w.attested_claim_sat),
      releasedSat: str(w.released_sat),
      escrowConserved: bool(w.escrow_conserved),
      finalizedCheckpoint: fc
        ? { epoch: num(fc.epoch), root: str(fc.root), ownRoot: str(fc.own_root), ownRuleActive: bool(fc.own_chain_rule_active) }
        : null,
    },
    accepted: acc ? { commitment: str(acc.commitment), statement: decodeStatement(acc.statement), rawStatement: str(acc.statement) } : null,
  };
}

/**
 * Whether withdrawal leaf `nonce` has been claimed on the L1: below `floor`
 * every leaf is claimed; above it, bit i of byte j of word w's bitmap is leaf
 * 256w + 8j + i (rpc.rs, `claimed.words`).
 */
export function isClaimed(nonce: number, floor: number, words: Map<number, string>): boolean {
  if (nonce < floor) return true;
  const bits = words.get(Math.floor(nonce / 256));
  if (!bits) return false;
  const b = hexToBytes(bits);
  if (!b) return false;
  const inWord = nonce % 256;
  const byte = b[Math.floor(inWord / 8)];
  return byte !== undefined && ((byte >> (inWord % 8)) & 1) === 1;
}

export type WithdrawalStage = "initiated" | "settled" | "claimable" | "claimed";

/**
 * Where an L2 withdrawal (outbox leaf `nonce`) stands on the L1:
 * - initiated: on the L2 only; no accepted settlement includes it yet;
 * - settled: in the accepted withdrawal tree, not yet claimable (delay or L1 finality);
 * - claimable: in the newest root a claim may prove against in the next L1 block
 *   (small claims; large ones wait `large_delay_blocks` and may need attestors);
 * - claimed: its nullifier is set on the L1.
 */
export function withdrawalStage(nonce: number, rec: L2SettlementRecord | null): WithdrawalStage {
  if (!rec) return "initiated";
  const w = rec.withdrawals;
  if (isClaimed(nonce, w.claimedFloor, w.claimedWords)) return "claimed";
  if (w.claimable && nonce < w.claimable.count) return "claimable";
  if (w.count !== null && nonce < w.count) return "settled";
  return "initiated";
}

// ─── /l2status envelope ─────────────────────────────────────────────────────

export interface L2StatusEnvelope {
  expectedChainId: number;
  fetchedAt: string | null;
  responding: number;
  agreeing: number;
  quorum: number;
  observers: number;
  corroborated: boolean;
  divergent: boolean;
  chainMismatch: boolean;
  record: L2SettlementRecord | null;
}

export function parseL2Status(raw: unknown): L2StatusEnvelope {
  const r = obj(raw) ?? {};
  return {
    expectedChainId: num(r.expected_chain_id) ?? 700770,
    fetchedAt: str(r.fetched_at),
    responding: num(r.responding) ?? 0,
    agreeing: num(r.agreeing) ?? 0,
    quorum: num(r.quorum) ?? 2,
    observers: Array.isArray(r.observers) ? r.observers.length : 0,
    corroborated: r.corroborated === true,
    divergent: r.divergent === true,
    chainMismatch: r.chain_mismatch === true,
    record: parseL2Settlement(r.settlement),
  };
}

type Env = { VITE_L2_STATUS_URL?: string };
function statusEndpoint(): string {
  let env: Env | undefined;
  try {
    env = (import.meta as unknown as { env?: Env }).env;
  } catch {
    env = undefined;
  }
  return env?.VITE_L2_STATUS_URL || "/l2status";
}

export async function readL2Status(fetchImpl: typeof fetch = fetch): Promise<L2StatusEnvelope> {
  const res = await fetchImpl(statusEndpoint(), { headers: { Accept: "application/json" } });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`/l2status answered HTTP ${res.status} without JSON`);
  }
  const b = obj(body);
  if (!res.ok && b && typeof b.error === "string") throw new Error(b.error);
  return parseL2Status(body);
}

/**
 * The honest one-line state of the L2, from the L1 record and (when
 * reachable) the L2 RPC. Used as the page headline.
 */
export type L2Phase = "not-installed" | "activated-unsettled" | "settling" | "unknown";

export function l2Phase(rec: L2SettlementRecord | null, statusKnown: boolean): L2Phase {
  if (!statusKnown) return "unknown";
  if (!rec || !rec.activated) return "not-installed";
  return rec.accepted ? "settling" : "activated-unsettled";
}
