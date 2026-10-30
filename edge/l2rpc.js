// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The read-only JSON-RPC policy behind POST /l2rpc (the /l2 explorer pages).
//
// The /l2 pages read the Bloch L2 (EVM, chain id 700770) through this one
// endpoint. The upstream is the public L2 RPC (`L2_RPC_URL`, e.g. the gateway
// in front of `bloch-l2-settled-rpc`), so the explorer adds no new trust: it
// shows what that RPC serves, including its `latest` / `safe` / `finalized`
// tags and `bloch_finality`.
//
// What this module adds on top of a passthrough:
//
//  1. A method allowlist with parameter checks. Nothing that writes
//     (`eth_sendRawTransaction`), nothing that subscribes or opens filters,
//     and `eth_call` only for the five ERC-20 view selectors the token
//     columns need, so the endpoint cannot be turned into a free compute
//     service in front of the L2 node.
//  2. A chain-id guard. Every forwarded batch carries one `eth_chainId` and
//     the whole answer is refused if the upstream serves another chain. A
//     mainnet explorer reading a devnet by misconfiguration is the failure
//     that would otherwise be silent.
//  3. Bounds: request size, batch size, upstream timeout, response size.
//  4. Settled-only reads (default; `L2_SETTLED_ONLY=0` turns it off). The
//     explorer shows only what the L1 has accepted: `latest` and `pending`
//     are read as `safe`, and any block, transaction, receipt or log above
//     the upstream's `safe` block is answered as absent. Every forwarded
//     batch carries one `eth_getBlockByNumber("safe")` probe for that bound.
//     State reads (balance, nonce, code, eth_call) take only a tag or a
//     block number at or below `safe`, never a block hash, because a hash
//     cannot be placed against the bound before the call is made.

export const DEFAULT_CHAIN_ID = 700770;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_BATCH = 100;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const UPSTREAM_TIMEOUT_MS = 12_000;
/** Inclusive block span allowed for one eth_getLogs with numeric bounds. */
export const MAX_LOG_SPAN = 200_000;

const H32 = /^0x[0-9a-fA-F]{64}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const QTY = /^0x(0|[1-9a-fA-F][0-9a-fA-F]{0,15})$/;
const TAGS = new Set(['latest', 'safe', 'finalized', 'earliest', 'pending']);

/** ERC-20 views: name, symbol, decimals, totalSupply, balanceOf(address). */
export const CALL_SELECTORS = {
  '0x06fdde03': 0,
  '0x95d89b41': 0,
  '0x313ce567': 0,
  '0x18160ddd': 0,
  '0x70a08231': 1,
};

class ParamError extends Error {}
const bad = (msg) => { throw new ParamError(msg); };

function blockRef(v) {
  if (typeof v === 'string' && (TAGS.has(v) || QTY.test(v))) return v;
  return bad('block must be a tag or a hex quantity');
}

function blockOrHash(v) {
  if (typeof v === 'string' && H32.test(v)) return v;
  if (v && typeof v === 'object' && typeof v.blockHash === 'string' && H32.test(v.blockHash)) return { blockHash: v.blockHash };
  return blockRef(v);
}

function exact(params, n) {
  if (!Array.isArray(params)) bad('params must be an array');
  if (params.length > n) bad(`at most ${n} params`);
  return params;
}

function addrAndBlock(p) {
  exact(p, 2);
  if (typeof p[0] !== 'string' || !ADDR.test(p[0])) bad('address expected');
  return [p[0], blockOrHash(p[1] ?? 'latest')];
}

function topicsOk(topics) {
  if (topics === undefined) return true;
  if (!Array.isArray(topics) || topics.length > 4) return false;
  return topics.every((t) => t === null || (typeof t === 'string' && H32.test(t))
    || (Array.isArray(t) && t.length <= 8 && t.every((x) => typeof x === 'string' && H32.test(x))));
}

function logsFilter(p) {
  exact(p, 1);
  const f = p[0];
  if (!f || typeof f !== 'object' || Array.isArray(f)) bad('filter object expected');
  const allowed = new Set(['fromBlock', 'toBlock', 'address', 'topics', 'blockHash']);
  for (const k of Object.keys(f)) if (!allowed.has(k)) bad(`unsupported filter field ${k}`);
  if (f.address !== undefined) {
    const list = Array.isArray(f.address) ? f.address : [f.address];
    if (list.length === 0 || list.length > 16 || !list.every((a) => typeof a === 'string' && ADDR.test(a))) bad('bad address filter');
  }
  if (!topicsOk(f.topics)) bad('bad topics filter');
  // An unfiltered scan of every log on the chain is not an explorer query.
  const hasTopic = Array.isArray(f.topics) && f.topics.some((t) => t !== null);
  if (f.address === undefined && !hasTopic) bad('eth_getLogs needs an address or a topic');
  if (f.blockHash !== undefined) {
    if (f.fromBlock !== undefined || f.toBlock !== undefined || !H32.test(f.blockHash)) bad('blockHash excludes a range');
    return [f];
  }
  const from = blockRef(f.fromBlock ?? 'latest');
  const to = blockRef(f.toBlock ?? 'latest');
  if (QTY.test(from) && QTY.test(to)) {
    const span = Number(BigInt(to) - BigInt(from));
    if (span < 0) bad('fromBlock above toBlock');
    if (span >= MAX_LOG_SPAN) bad(`log range over ${MAX_LOG_SPAN} blocks`);
  }
  return [f];
}

function callParams(p) {
  exact(p, 2);
  const c = p[0];
  if (!c || typeof c !== 'object' || Array.isArray(c)) bad('call object expected');
  for (const k of Object.keys(c)) if (!['to', 'data', 'input'].includes(k)) bad(`unsupported call field ${k}`);
  if (typeof c.to !== 'string' || !ADDR.test(c.to)) bad('call needs a contract address');
  const data = (c.data ?? c.input);
  if (typeof data !== 'string') bad('call data expected');
  const sel = data.slice(0, 10).toLowerCase();
  const words = CALL_SELECTORS[sel];
  if (words === undefined) bad('only ERC-20 view calls are served');
  if (data.length !== 10 + 64 * words || !/^0x[0-9a-fA-F]*$/.test(data)) bad('call data length');
  if (words === 1 && !/^0x70a08231000000000000000000000000[0-9a-fA-F]{40}$/.test(data)) bad('balanceOf takes one address');
  return [{ to: c.to, data }, blockOrHash(p[1] ?? 'latest')];
}

const METHODS = {
  eth_chainId: (p) => exact(p ?? [], 0),
  eth_blockNumber: (p) => exact(p ?? [], 0),
  eth_gasPrice: (p) => exact(p ?? [], 0),
  bloch_finality: (p) => exact(p ?? [], 0),
  // Optional per-block settlement lookup (see docs/L2-EXPLORER.md). Refused
  // upstream with -32601 until the settled RPC serves it; the pages degrade.
  bloch_settlement: (p) => { exact(p, 1); return [blockRef(p[0])]; },
  eth_getBlockByNumber: (p) => { exact(p, 2); return [blockRef(p[0]), p[1] === true]; },
  eth_getBlockByHash: (p) => { exact(p, 2); if (!H32.test(p[0] ?? '')) bad('hash expected'); return [p[0], p[1] === true]; },
  eth_getBlockReceipts: (p) => { exact(p, 1); return [blockOrHash(p[0])]; },
  eth_getBlockTransactionCountByNumber: (p) => { exact(p, 1); return [blockRef(p[0])]; },
  eth_getTransactionByHash: (p) => { exact(p, 1); if (!H32.test(p[0] ?? '')) bad('hash expected'); return [p[0]]; },
  eth_getTransactionReceipt: (p) => { exact(p, 1); if (!H32.test(p[0] ?? '')) bad('hash expected'); return [p[0]]; },
  eth_getBalance: addrAndBlock,
  eth_getTransactionCount: addrAndBlock,
  eth_getCode: addrAndBlock,
  eth_getLogs: logsFilter,
  eth_call: callParams,
};

export const ALLOWED_METHODS = Object.freeze(Object.keys(METHODS));

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * Validate one JSON-RPC call. Returns `{ call }` (normalised, safe to
 * forward) or `{ error }` (a complete JSON-RPC error response).
 */
export function checkCall(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c) || c.jsonrpc !== '2.0' || typeof c.method !== 'string') {
    return { error: rpcError(c?.id, -32600, 'invalid request') };
  }
  const id = c.id;
  if (!(typeof id === 'number' || (typeof id === 'string' && id.length <= 64))) {
    return { error: rpcError(null, -32600, 'id must be a number or a short string') };
  }
  const check = Object.prototype.hasOwnProperty.call(METHODS, c.method) ? METHODS[c.method] : null;
  if (!check) return { error: rpcError(id, -32601, `method not served by the explorer: ${c.method.slice(0, 64)}`) };
  try {
    return { call: { jsonrpc: '2.0', id, method: c.method, params: check(c.params ?? []) } };
  } catch (e) {
    if (e instanceof ParamError) return { error: rpcError(id, -32602, e.message) };
    throw e;
  }
}

/** Parse `L2_RPC_URL` (one or more space-separated http(s) URLs). */
export function upstreams(env) {
  return String(env?.L2_RPC_URL ?? '').split(/\s+/).filter(Boolean).filter((u) => {
    try { const p = new URL(u).protocol; return p === 'https:' || p === 'http:'; } catch { return false; }
  });
}

export function chainId(env) {
  const n = Number(env?.L2_CHAIN_ID ?? DEFAULT_CHAIN_ID);
  return Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_CHAIN_ID;
}

const CHAIN_PROBE_ID = '__l2_chain_id_guard__';
const SAFE_PROBE_ID = '__l2_safe_bound__';

/** Settled-only mode is on unless `L2_SETTLED_ONLY` is 0/false/off. */
export function settledOnly(env) {
  return !/^(0|false|off|no)$/i.test(String(env?.L2_SETTLED_ONLY ?? '1').trim());
}

/** Error code for a read above the settled bound. */
export const NOT_SETTLED = -32001;

const STATE_METHODS = new Set(['eth_getBalance', 'eth_getTransactionCount', 'eth_getCode', 'eth_call']);
const unsettledTag = (v) => v === 'latest' || v === 'pending';

/**
 * Rewrite a checked call for settled-only mode: `latest`/`pending` become
 * `safe`. Returns `{ call }` or `{ error }` (a state read by block hash).
 */
export function settleCall(call) {
  const p = call.params.slice();
  const m = call.method;
  const tagAt = (i) => { if (unsettledTag(p[i])) p[i] = 'safe'; };
  if (m === 'eth_getBlockByNumber' || m === 'eth_getBlockReceipts' || m === 'eth_getBlockTransactionCountByNumber') tagAt(0);
  if (STATE_METHODS.has(m)) {
    tagAt(1);
    if (typeof p[1] !== 'string' || H32.test(p[1])) {
      return { error: rpcError(call.id, -32602, 'state reads take a block tag or number in settled-only mode') };
    }
  }
  if (m === 'eth_getLogs') {
    const f = { ...p[0] };
    if (f.blockHash === undefined) {
      f.fromBlock = unsettledTag(f.fromBlock ?? 'latest') ? 'safe' : f.fromBlock;
      f.toBlock = unsettledTag(f.toBlock ?? 'latest') ? 'safe' : f.toBlock;
    }
    p[0] = f;
  }
  return { call: { ...call, params: p } };
}

const qtyOf = (v) => (typeof v === 'string' && QTY.test(v) ? Number(BigInt(v)) : null);

/**
 * Apply the settled bound to one upstream answer. `safe` is the upstream's
 * safe block number, or null when it has none (nothing is settled).
 */
export function boundAnswer(call, answer, safe) {
  if (!answer || 'error' in answer) return answer;
  const above = (n) => n === null || safe === null || n > safe;
  const r = answer.result;
  const none = { jsonrpc: '2.0', id: call.id, result: null };
  switch (call.method) {
    case 'eth_blockNumber':
      return safe === null
        ? rpcError(call.id, NOT_SETTLED, 'no L2 block is settled on the L1 yet')
        : { jsonrpc: '2.0', id: call.id, result: '0x' + safe.toString(16) };
    case 'eth_getBlockByNumber':
    case 'eth_getBlockByHash':
      return r && above(qtyOf(r.number)) ? none : answer;
    case 'eth_getTransactionByHash':
    case 'eth_getTransactionReceipt':
      return r && above(qtyOf(r.blockNumber)) ? none : answer;
    case 'eth_getBlockReceipts': {
      const n = qtyOf(call.params[0]);
      if (n !== null && above(n)) return none;
      if (Array.isArray(r) && r.some((x) => above(qtyOf(x?.blockNumber)))) return none;
      return answer;
    }
    case 'eth_getBlockTransactionCountByNumber': {
      const n = qtyOf(call.params[0]);
      return n !== null && above(n) ? none : answer;
    }
    case 'eth_getLogs':
      return Array.isArray(r) ? { ...answer, result: r.filter((l) => !above(qtyOf(l?.blockNumber))) } : answer;
    default:
      return answer;
  }
}

/** State reads at an explicit block number above the bound are refused. */
function stateAboveBound(call, safe) {
  if (!STATE_METHODS.has(call.method)) return false;
  const n = qtyOf(call.params[1]);
  if (call.params[1] === 'safe' || call.params[1] === 'finalized') return safe === null;
  return n !== null && (safe === null || n > safe);
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

async function readCapped(res, cap) {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error('upstream response too large'); }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

async function forwardOnce(url, calls, expectChain, fetchImpl, settled) {
  const probes = [{ jsonrpc: '2.0', id: CHAIN_PROBE_ID, method: 'eth_chainId', params: [] }];
  if (settled) probes.push({ jsonrpc: '2.0', id: SAFE_PROBE_ID, method: 'eth_getBlockByNumber', params: ['safe', false] });
  const batch = [...probes, ...calls];
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const parsed = JSON.parse(await readCapped(res, MAX_RESPONSE_BYTES));
  if (!Array.isArray(parsed)) throw new Error('upstream did not answer the batch');
  const byId = new Map(parsed.filter((r) => r && typeof r === 'object').map((r) => [r.id, r]));
  const probe = byId.get(CHAIN_PROBE_ID);
  const got = probe && typeof probe.result === 'string' ? Number.parseInt(probe.result, 16) : NaN;
  if (got !== expectChain) {
    const err = new Error(`upstream serves chain ${Number.isNaN(got) ? 'unknown' : got}, expected ${expectChain}`);
    err.chainMismatch = true;
    throw err;
  }
  let safe = null;
  if (settled) {
    const sp = byId.get(SAFE_PROBE_ID);
    const n = sp && sp.result ? qtyOf(sp.result.number) : null;
    safe = Number.isSafeInteger(n) ? n : null;
  }
  return calls.map((c) => {
    const r = byId.get(c.id);
    if (!r) return rpcError(c.id, -32603, 'upstream returned no answer for this call');
    const a = 'error' in r ? { jsonrpc: '2.0', id: c.id, error: r.error } : { jsonrpc: '2.0', id: c.id, result: r.result ?? null };
    if (!settled) return a;
    if (stateAboveBound(c, safe)) return rpcError(c.id, NOT_SETTLED, 'that L2 block is not settled on the L1 yet');
    return boundAnswer(c, a, safe);
  });
}

/**
 * Handle one POST body. `fetchImpl` is injectable for tests.
 * Returns a Response.
 */
export async function handleL2Rpc(request, env, fetchImpl = fetch) {
  const urls = upstreams(env);
  if (urls.length === 0) {
    return json(rpcError(null, -32000, 'the L2 RPC upstream is not configured (L2_RPC_URL)'), 503);
  }
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY_BYTES) return json(rpcError(null, -32600, 'request too large'), 413);
  let text;
  try { text = await request.text(); } catch { return json(rpcError(null, -32700, 'unreadable body'), 400); }
  if (text.length > MAX_BODY_BYTES) return json(rpcError(null, -32600, 'request too large'), 413);
  let body;
  try { body = JSON.parse(text); } catch { return json(rpcError(null, -32700, 'parse error'), 400); }
  const isBatch = Array.isArray(body);
  const items = isBatch ? body : [body];
  if (items.length === 0 || items.length > MAX_BATCH) {
    return json(rpcError(null, -32600, `batch must hold 1 to ${MAX_BATCH} calls`), 400);
  }
  const settled = settledOnly(env);
  const checked = items.map(checkCall).map((c) => (settled && c.call ? settleCall(c.call) : c));
  const ids = new Set();
  for (const c of checked) {
    if (!c.call) continue;
    if (ids.has(c.call.id) || c.call.id === CHAIN_PROBE_ID || c.call.id === SAFE_PROBE_ID) return json(rpcError(null, -32600, 'duplicate or reserved id in batch'), 400);
    ids.add(c.call.id);
  }
  const calls = checked.filter((c) => c.call).map((c) => c.call);
  let answers = [];
  if (calls.length) {
    let lastError = null;
    for (const url of urls) {
      try {
        answers = await forwardOnce(url, calls, chainId(env), fetchImpl, settled);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (e.chainMismatch) break;
      }
    }
    if (lastError) {
      const msg = lastError.chainMismatch ? lastError.message : 'the L2 RPC is unreachable or answered badly';
      return json(rpcError(null, -32000, msg), 502);
    }
  }
  const byId = new Map(answers.map((a) => [a.id, a]));
  const out = checked.map((c) => (c.call ? byId.get(c.call.id) : c.error));
  return json(isBatch ? out : out[0]);
}

/** GET /l2rpc: what this endpoint serves, for operators and monitors. */
export function describeL2Rpc(env) {
  const urls = upstreams(env);
  return json({
    service: 'Bloch L2 explorer read endpoint',
    chainId: chainId(env),
    configured: urls.length > 0,
    upstreamHosts: urls.map((u) => new URL(u).host),
    methods: ALLOWED_METHODS,
    maxBatch: MAX_BATCH,
    settledOnly: settledOnly(env),
  });
}
