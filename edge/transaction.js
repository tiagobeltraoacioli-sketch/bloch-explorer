// SPDX-License-Identifier: AGPL-3.0-or-later
import { handleApi } from './api.js';
import { Bucket } from './governor.js';

const HASH = /^[0-9a-f]{64}$/i;
const INDEXER = 'http://139.180.166.5.nip.io:8080/indexer/';
export const TRANSACTION_DEADLINE_MS = 10_000;
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const MAX_INFLIGHT = 16;
let budget = new Bucket(40, 15, Date.now);
const inflight = new Map();
const uint = value => Number.isSafeInteger(value) && value >= 0;
const uint32 = value => uint(value) && value <= 0xffff_ffff;
const hash = value => typeof value === 'string' && HASH.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const U64_MAX = '18446744073709551615';
const U128_MAX = '340282366920938463463374607431768211455';

// The indexer serializes satoshis as canonical decimal strings. Compare bounded
// strings without converting to Number (which would round valid u64 amounts).
function decimal(value, max) {
  return typeof value === 'string' && value.length <= max.length &&
    /^(0|[1-9][0-9]*)$/.test(value) &&
    (value.length < max.length || value <= max);
}

function validIo(io) {
  return object(io) && uint32(io.vout) && decimal(io.value_sat, U64_MAX) && hash(io.script_hash);
}

function validInputs(inputs) {
  if (!Array.isArray(inputs)) return false;
  const seen = new Set();
  return inputs.every(io => {
    if (!validIo(io) || !hash(io.txid)) return false;
    const outpoint = io.txid.toLowerCase() + ':' + io.vout;
    if (seen.has(outpoint)) return false;
    seen.add(outpoint);
    return true;
  });
}

function failure(status, code, error, extra = {}) {
  const retryable = status === 503 || status === 429;
  return { status, headers: retryable ? { 'retry-after': status === 429 ? '1' : '2' } : {},
    body: { error, code, retryable, ...extra } };
}

// Bound allocation while reading, not after buffering an arbitrary upstream body.
async function readReceipt(response, signal) {
  if (!response.body) throw new Error('empty receipt');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RECEIPT_BYTES) throw new Error('receipt too large');
      chunks.push(value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}

function validReceipt(receipt, txid) {
  return object(receipt) && hash(receipt.txid) && receipt.txid.toLowerCase() === txid &&
    hash(receipt.block_id) && hash(receipt.chain_tip) && validInputs(receipt.inputs) &&
    Array.isArray(receipt.outputs) && receipt.outputs.every((io, index) =>
      validIo(io) && io.vout === index &&
      (!Object.hasOwn(io, 'txid') || hash(io.txid) && io.txid.toLowerCase() === txid)) &&
    // Auxiliary metadata and output txids remain optional at this API boundary.
    // Validate supplied values; null fee means input valuation unavailable.
    (!Object.hasOwn(receipt, 'fee_sat') || receipt.fee_sat === null || decimal(receipt.fee_sat, U128_MAX)) &&
    (!Object.hasOwn(receipt, 'stake_sat') || decimal(receipt.stake_sat, U128_MAX)) &&
    (!Object.hasOwn(receipt, 'index') || uint32(receipt.index)) &&
    (!Object.hasOwn(receipt, 'size_bytes') || uint(receipt.size_bytes)) &&
    (!Object.hasOwn(receipt, 'kind') || typeof receipt.kind === 'string' && receipt.kind.length > 0) &&
    uint(receipt.height) && uint(receipt.slot) && uint(receipt.as_of_height) &&
    uint(receipt.as_of_slot) && receipt.height <= receipt.as_of_height &&
    receipt.slot <= receipt.as_of_slot;
}

function usableHead(response) {
  const head = response?.body?.data;
  return response?.status === 200 &&
    ['corroborated', 'final'].includes(response.body?.corroboration?.level) &&
    uint(head?.height) && uint(head?.slot) && uint(head?.finalized_height) &&
    head.finalized_height <= head.height && HASH.test(head.block_id);
}

async function lookup(txid, opts, fetchImpl, readApi) {
  const controller = new AbortController();
  // One deadline covers receipt/body, corroboration and one refresh. Abort
  // alone cannot bound a non-cooperating reader, so race the entire operation.
  const now = opts.now || Date.now;
  const requested = Number.isFinite(opts.budgetMs) && opts.budgetMs > 0 ? opts.budgetMs : TRANSACTION_DEADLINE_MS;
  const timeout = Math.max(1, Math.min(TRANSACTION_DEADLINE_MS, requested,
    Number.isFinite(opts.deadlineAt) ? opts.deadlineAt - now() : TRANSACTION_DEADLINE_MS));
  const deadlineAt = now() + timeout;
  const scoped = { ...opts, deadlineAt, budgetMs: timeout,
    fetchImpl: (url, init = {}) => {
      controller.signal.throwIfAborted();
      return (opts.fetchImpl || fetchImpl)(url, { ...init,
        signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
    } };
  let timer;
  const expired = new Promise(resolve => {
    timer = setTimeout(() => {
      resolve(failure(503, 'LOOKUP_DEADLINE_EXCEEDED', 'Transaction lookup deadline exceeded'));
      controller.abort();
    }, timeout);
  });
  const work = async () => {
    // Resolve the index first: a missing/malformed receipt must not spend a
    // finality read or cancel one shared by unrelated RPC callers.
    let response;
    try {
      response = await fetchImpl(INDEXER + 'tx/' + txid, {
        signal: controller.signal, redirect: 'manual', headers: { accept: 'application/json' },
      });
    } catch { return failure(503, 'INDEX_UNAVAILABLE', 'Historical transaction index is unavailable'); }
    if (response.status === 404) {
      void response.body?.cancel().catch(() => {});
      return failure(404, 'TX_NOT_INDEXED', 'Transaction is not in the canonical archival index; pending status is unknown', { txid });
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      void response.body?.cancel().catch(() => {});
      return failure(503, 'INDEX_UNAVAILABLE', 'Historical transaction index is unavailable');
    }
    let receipt;
    try { receipt = await readReceipt(response, controller.signal); }
    catch { return failure(503, 'INDEX_RECEIPT_INVALID', 'Historical transaction receipt is invalid or incomplete'); }
    if (!validReceipt(receipt, txid)) return failure(503, 'INDEX_RECEIPT_INVALID', 'Historical transaction receipt is invalid or incomplete');
    let headResponse = await readApi('/api/v1/status', new URLSearchParams(), scoped);
    let head = headResponse?.body?.data;
    // The index can be ahead of the status read's 3s cache. Refresh once,
    // without widening the finality/freshness criteria.
    if (usableHead(headResponse) &&
        (head.height < receipt.as_of_height || head.slot < receipt.as_of_slot) &&
        !controller.signal.aborted && now() < deadlineAt) {
      headResponse = await readApi('/api/v1/status', new URLSearchParams(), { ...scoped, cache: null });
      head = headResponse?.body?.data;
    }
    if (headResponse?.status === 429) return failure(429, 'FINALITY_RATE_LIMITED', 'Finality read budget exceeded');
    if (!usableHead(headResponse) || head.height < receipt.as_of_height ||
        head.slot < receipt.as_of_slot || head.slot - receipt.as_of_slot > 2) {
      return failure(503, 'FINALITY_UNAVAILABLE', 'Fresh corroborated finality status is unavailable');
    }
    if (head.height === receipt.as_of_height &&
        (head.slot !== receipt.as_of_slot || head.block_id.toLowerCase() !== receipt.chain_tip.toLowerCase())) {
      return failure(503, 'INDEX_LINEAGE_MISMATCH', 'Transaction index and corroborated head disagree');
    }
    const finalized = receipt.height <= head.finalized_height;
    return { status: 200, body: {
      ...receipt,
      confirmations: head.height - receipt.height + 1,
      status: finalized ? 'finalized' : 'confirmed', finalized,
      finalized_height: head.finalized_height, observed_head_height: head.height,
      observed_head_slot: head.slot, corroboration: headResponse.body.corroboration.level,
    } };
  };
  try {
    return await Promise.race([expired, work().catch(() =>
      failure(503, 'LOOKUP_UNAVAILABLE', 'Transaction lookup is temporarily unavailable'))]);
  } finally { clearTimeout(timer); controller.abort(); }
}

export async function transactionDetails(txid, opts, fetchImpl = fetch, readApi = handleApi) {
  if (typeof txid !== 'string' || !HASH.test(txid)) return failure(400, 'INVALID_TXID', 'txid must be 64 hexadecimal characters');
  if (!budget.take()) return failure(429, 'LOOKUP_RATE_LIMITED', 'Transaction lookup read budget exceeded');
  txid = txid.toLowerCase();
  // Share overlapping work only; never reuse a previous finality result.
  // Separate clients/configurations for the core's client read budget.
  const key = JSON.stringify([txid, opts.clientKey, opts.pools]);
  if (inflight.has(key)) return inflight.get(key);
  if (inflight.size >= MAX_INFLIGHT) return failure(429, 'LOOKUP_BUSY', 'Transaction lookup concurrency limit reached');
  const pending = lookup(txid, opts, fetchImpl, readApi);
  inflight.set(key, pending);
  try { return await pending; }
  finally { if (inflight.get(key) === pending) inflight.delete(key); }
}

export function _resetTransactionForTests() {
  inflight.clear();
  budget = new Bucket(40, 15, Date.now);
}
