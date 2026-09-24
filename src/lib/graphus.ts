// SPDX-License-Identifier: AGPL-3.0-or-later

/** Public Bloch facts for the Graphus view. No address ownership is inferred. */
export interface GraphusIo { txid: string | null; vout: number; valueSat: string; scriptHash: string }
export interface GraphusTransaction {
  txid: string; blockId: string; slot: number; height: number; kind: string;
  feeSat: string | null; inputs: GraphusIo[]; outputs: GraphusIo[];
}

const hash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const sat = (value: unknown): value is string => typeof value === "string" && /^\d{1,100}$/.test(value);

export function graphusTransaction(value: unknown): GraphusTransaction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tx = value as Record<string, unknown>;
  if (!hash(tx.txid) || !hash(tx.block_id) || !count(tx.slot) || !count(tx.height) ||
      typeof tx.kind !== "string" || tx.kind.length > 48 ||
      !Array.isArray(tx.inputs) || !Array.isArray(tx.outputs) ||
      tx.inputs.length > 2048 || tx.outputs.length > 2048) return null;
  const parseSide = (side: unknown[], input: boolean): GraphusIo[] | null => {
    const parsed: GraphusIo[] = [];
    for (const item of side) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const io = item as Record<string, unknown>;
      if (!count(io.vout) || !sat(io.value_sat) || !hash(io.script_hash) ||
          (input && io.txid != null && !hash(io.txid))) return null;
      parsed.push({ txid: input ? typeof io.txid === "string" ? io.txid : null : tx.txid as string,
        vout: io.vout, valueSat: io.value_sat, scriptHash: io.script_hash });
    }
    return parsed;
  };
  const inputs = parseSide(tx.inputs, true), outputs = parseSide(tx.outputs, false);
  if (!inputs || !outputs) return null;
  return { txid: tx.txid, blockId: tx.block_id, slot: tx.slot, height: tx.height,
    kind: tx.kind, feeSat: sat(tx.fee_sat) ? tx.fee_sat : null, inputs, outputs };
}

export function graphusPage(value: unknown): { transactions: GraphusTransaction[]; asOfSlot: number; source: string; verification: string | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.transactions) || page.transactions.length > 8 || !count(page.as_of_slot) ||
      typeof page.source !== "string" || page.source.length > 160 ||
      (page.verification != null && (typeof page.verification !== "string" || page.verification.length > 160))) return null;
  const transactions = page.transactions.map(graphusTransaction);
  if (transactions.some(tx => tx === null)) return null;
  return { transactions: transactions as GraphusTransaction[], asOfSlot: page.as_of_slot,
    source: page.source, verification: typeof page.verification === "string" ? page.verification : null };
}

export interface GraphusEvent {
  kind: "created" | "spent"; txid: string; transactionId: string | null; blockId: string | null;
  vout: number; valueSat: string; slot: number; height: number;
}
export interface GraphusHistory {
  scriptHash: string; total: number; events: GraphusEvent[];
  asOfSlot: number; source: string; verification: string | null;
}

/** Script references that occur in the same sampled transactions as the focus.
 * Co-occurrence is evidence of a shared transaction, never proof of ownership
 * or a payment from one script reference to another. */
export interface GraphusNeighbor {
  scriptHash: string; transactions: number; inputSat: string; outputSat: string;
  inputCount: number; outputCount: number; txids: string[];
}

export function graphusNeighbors(focus: string, transactions: GraphusTransaction[]): GraphusNeighbor[] {
  if (!hash(focus)) return [];
  const neighbors = new Map<string, { txids: Set<string>; inputSat: bigint; outputSat: bigint; inputCount: number; outputCount: number }>();
  for (const tx of transactions) {
    if (![...tx.inputs, ...tx.outputs].some(io => io.scriptHash === focus)) continue;
    for (const [side, entries] of [["input", tx.inputs], ["output", tx.outputs]] as const) {
      for (const io of entries) {
        if (io.scriptHash === focus) continue;
        const node = neighbors.get(io.scriptHash) ?? { txids: new Set<string>(), inputSat: 0n, outputSat: 0n, inputCount: 0, outputCount: 0 };
        node.txids.add(tx.txid);
        if (side === "input") { node.inputSat += BigInt(io.valueSat); node.inputCount++; }
        else { node.outputSat += BigInt(io.valueSat); node.outputCount++; }
        neighbors.set(io.scriptHash, node);
      }
    }
  }
  return [...neighbors].map(([scriptHash, node]) => ({ scriptHash, transactions: node.txids.size,
    inputSat: node.inputSat.toString(), outputSat: node.outputSat.toString(),
    inputCount: node.inputCount, outputCount: node.outputCount, txids: [...node.txids] }))
    .sort((a, b) => b.transactions - a.transactions || a.scriptHash.localeCompare(b.scriptHash));
}

export function graphusHistory(value: unknown, expectedScriptHash: string): GraphusHistory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const page = value as Record<string, unknown>;
  if (!hash(expectedScriptHash) || page.script_hash !== expectedScriptHash ||
      !count(page.total) || !count(page.as_of_slot) ||
      typeof page.source !== "string" || page.source.length > 160 ||
      (page.verification != null && (typeof page.verification !== "string" || page.verification.length > 160)) ||
      !Array.isArray(page.events) || page.events.length > 24 || page.events.length > page.total) return null;
  const events: GraphusEvent[] = [];
  for (const item of page.events) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const event = item as Record<string, unknown>;
    if ((event.kind !== "created" && event.kind !== "spent") || !hash(event.txid) ||
        (event.transaction_id != null && !hash(event.transaction_id)) ||
        (event.block_id != null && !hash(event.block_id)) ||
        !count(event.vout) || !sat(event.value_sat) || !count(event.slot) || !count(event.height)) return null;
    events.push({ kind: event.kind, txid: event.txid,
      transactionId: typeof event.transaction_id === "string" ? event.transaction_id : null,
      blockId: typeof event.block_id === "string" ? event.block_id : null,
      vout: event.vout, valueSat: event.value_sat, slot: event.slot, height: event.height });
  }
  return { scriptHash: expectedScriptHash, total: page.total, events,
    asOfSlot: page.as_of_slot, source: page.source,
    verification: typeof page.verification === "string" ? page.verification : null };
}
