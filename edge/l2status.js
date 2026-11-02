// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GET /l2status: the Bloch L2's settlement record as the L1 holds it.
//
// The L1 node answers `getl2settlement` with the committed state of the one
// installed L2: identity (chain id, network, genesis), the frozen source the
// next settlement must use, the deposit inbox and its escrow, the retained
// data-availability records, the withdrawal tree with its claim limits and
// attestor set, and the accepted settlement head (`accepted`, null before the
// first one). Everything here is consensus state, so this endpoint reads it
// from every configured L1 observer and serves it only with the number of
// observers that agree.
//
// Agreement is decided on the settlement fields only. `native_height`, the
// finalized checkpoint, the release window index and the per-record
// `finalized` / `claimable` / `matured` views move with every L1 block or
// checkpoint, so two honest nodes one slot apart would never match on them.
// The served answer is the newest (highest `native_height`) answer of the
// largest agreeing group.
//
// The L2 RPC (`/l2rpc`) is a different trust domain (one operator's settled
// RPC); this endpoint never consults it.

import { parsePools } from './pool.js';

export const DEFAULT_L2_CHAIN_ID = 700770;
export const UPSTREAM_TIMEOUT_MS = 8_000;
export const MAX_RESPONSE_BYTES = 512 * 1024;
/** Observers that must return identical settlement fields. */
export const QUORUM = 2;

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

/**
 * The fields two observers must agree on: everything in `getl2settlement`
 * except what moves with the L1 head or checkpoint.
 */
export function consensusView(r) {
  if (!r || typeof r !== 'object') return null;
  const w = r.withdrawals && typeof r.withdrawals === 'object' ? r.withdrawals : {};
  const rec = (x) => (x && typeof x === 'object' ? { l2_number: x.l2_number, root: x.root, count: x.count, height: x.height } : x ?? null);
  const rw = w.release_window && typeof w.release_window === 'object' ? w.release_window : null;
  return sortKeys({
    asynchronous: r.asynchronous ?? null,
    network: r.network ?? null,
    genesis: r.genesis ?? null,
    chain_id: r.chain_id ?? null,
    source: r.source ?? null,
    profile: r.profile ?? null,
    inbox: r.inbox ?? null,
    data_availability: r.data_availability ?? null,
    withdrawals: {
      root: w.root ?? null,
      count: w.count ?? null,
      roots: Array.isArray(w.roots) ? w.roots.map(rec) : null,
      finalized_claims_from_height: w.finalized_claims_from_height ?? null,
      delay_blocks: w.delay_blocks ?? null,
      claimed: w.claimed ?? null,
      large_claim_sat: w.large_claim_sat ?? null,
      large_delay_blocks: w.large_delay_blocks ?? null,
      retention_blocks: w.retention_blocks ?? null,
      release_window: rw && { blocks: rw.blocks, bps: rw.bps, floor_sat: rw.floor_sat },
      attestor_set: w.attestor_set ?? null,
      attested_claim_sat: w.attested_claim_sat ?? null,
      released_sat: w.released_sat ?? null,
      escrow_conserved: w.escrow_conserved ?? null,
    },
    accepted: r.accepted ?? null,
  });
}

async function readCapped(res, cap) {
  const text = await res.text();
  if (text.length > cap) throw new Error('response too large');
  return text;
}

async function ask(url, fetchImpl) {
  const started = Date.now();
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getl2settlement', params: [] }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) return { url, ok: false, reason: `HTTP ${res.status}` };
    const body = JSON.parse(await readCapped(res, MAX_RESPONSE_BYTES));
    if (body && body.error) return { url, ok: false, reason: `rpc error ${body.error.code ?? ''}`.trim() };
    if (!body || !('result' in body)) return { url, ok: false, reason: 'no result' };
    return { url, ok: true, result: body.result, ms: Date.now() - started };
  } catch (e) {
    return { url, ok: false, reason: e && e.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
}

const hostOf = (u) => {
  try { return new URL(u).host.replace(/\.nip\.io(?=:|$)/, ''); } catch { return 'invalid'; }
};

/**
 * Read `getl2settlement` from every observer and decide what may be served.
 * Pure apart from `fetchImpl`.
 */
export async function readL2Status(env, fetchImpl = fetch, now = Date.now()) {
  const expect = Number(env?.L2_CHAIN_ID ?? DEFAULT_L2_CHAIN_ID) || DEFAULT_L2_CHAIN_ID;
  const pools = parsePools(env);
  const urls = [...new Set([...pools.archivals, ...pools.fleet])];
  const answers = await Promise.all(urls.map((u) => ask(u, fetchImpl)));
  const observers = answers.map((a) => ({
    host: hostOf(a.url),
    ok: a.ok,
    ...(a.ok ? { native_height: typeof a.result?.native_height === 'number' ? a.result.native_height : null } : { reason: a.reason }),
  }));
  const groups = new Map();
  for (const a of answers) {
    if (!a.ok) continue;
    // A node without an installed L2 answers null: that is a view too, and a
    // disagreement with nodes that have one.
    const key = JSON.stringify(consensusView(a.result));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const ranked = [...groups.values()].sort((x, y) => y.length - x.length);
  const best = ranked[0] ?? [];
  const newest = best.slice().sort((x, y) => (y.result?.native_height ?? 0) - (x.result?.native_height ?? 0))[0];
  const settlement = newest ? newest.result : null;
  const agreeing = best.length;
  const corroborated = agreeing >= QUORUM && (ranked[1]?.length ?? 0) < agreeing;
  const chainOk = settlement === null || settlement.chain_id === expect;
  return {
    service: 'Bloch L2 settlement record on the Bloch L1 (getl2settlement)',
    expected_chain_id: expect,
    fetched_at: new Date(now).toISOString(),
    observers,
    responding: answers.filter((a) => a.ok).length,
    agreeing,
    quorum: QUORUM,
    corroborated: corroborated && chainOk,
    divergent: ranked.length > 1,
    chain_mismatch: !chainOk,
    settlement: chainOk ? settlement : null,
  };
}

export async function handleL2Status(env, fetchImpl = fetch) {
  let body;
  let status = 200;
  try {
    body = await readL2Status(env, fetchImpl);
    if (body.responding === 0) status = 502;
  } catch (e) {
    status = 500;
    body = { error: 'the L1 observer pool is misconfigured', detail: String(e?.message ?? e) };
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Settlement state moves at most once per L1 slot (30 s).
      'Cache-Control': 'public, max-age=15',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
