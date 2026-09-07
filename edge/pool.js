// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The upstream pools, and the single attempt against one of them.
//
// # Two pools, not one, and they are not interchangeable
//
// ARCHIVALS are the data plane. Both are keyless observers: they carry no
// `validator.key`, they are started in the node's observer mode ("this node
// follows the chain, applies every block and serves the RPC. It does not
// propose and does not attest"), and they have proposed zero blocks. That is
// the property that matters — a node that cannot propose cannot manufacture a
// branch of its own, so the worst it can do to a reader is be BEHIND or be
// DOWN. Every read this edge serves comes from here.
//
// FLEET boxes are the witness plane. They are validators. They are asked one
// question, `getchaininfo`, at most once per WITNESS_TTL_MS across the whole
// isolate no matter how much traffic arrives, and they are asked it for one
// reason: to certify that the lineage the archivals answered from is the
// lineage the fleet is building on.
//
// # Why the split, when `functions/g4rpc.js` does not split
//
// g4rpc's rule — wave 1 must reach a fleet box, and a group without one never
// wins — is correct and this file keeps its conclusion. What it does not do is
// bound the cost: g4rpc pays a fleet round trip per uncached call, so fleet
// load is a function of public traffic. An explorer is, by construction, a
// load generator, and the node's RPC is served from the consensus thread from
// a port with no authentication and no rate limit. So here the fleet is
// consulted on a schedule instead of on demand, and the archivals absorb the
// traffic. Fleet load becomes a constant.
//
// # Two archivals agreeing is not corroboration
//
// They are the same population: same role, same operator, same provisioning,
// and — measured 2026-09-01 — the same binary generation, which is OLDER than
// the repo's (all nine deployed upstreams answer -32601 to `getcapabilities`,
// a method frozen into RPC_SURFACE at surface version 4.1.0). Two nodes built
// from one stale artefact fail identically. So `quorum` from the archivals is
// necessary and not sufficient, and `lineage.js` supplies the rest.

/**
 * The keyless archival observers. Data plane.
 *
 * Override with env.EXPLORER_ARCHIVALS (whitespace or comma separated). An
 * explicitly EMPTY string is not accepted: an edge with no archival pool would
 * silently promote the fleet to the data plane, which is the one thing this
 * file exists to prevent.
 */
export const DEFAULT_ARCHIVALS = [
  'http://139.180.166.5.nip.io:8080/',
  'http://139.180.173.231.nip.io:8080/',
];

/**
 * Fleet validators. Witness plane and tiebreaker ONLY.
 *
 * Same list `functions/g4rpc.js` carries minus the two archivals, so the two
 * proxies do not drift apart on who is who.
 */
export const DEFAULT_FLEET = [
  'http://139.84.201.52.nip.io:8080/',
  'http://139.84.202.139.nip.io:8080/',
  'http://139.84.204.46.nip.io:8080/',
  'http://139.84.205.54.nip.io:8080/',
  'http://149.28.180.128.nip.io:8080/',
  'http://67.219.108.230.nip.io:8080/',
  'http://67.219.108.96.nip.io:8080/',
];

function parseList(raw, fallback) {
  if (raw === undefined || raw === null) return fallback.slice();
  const list = String(raw)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const value of list) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Invalid RPC pool URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error('RPC pools require HTTP(S) URLs without credentials or fragments');
    }
    if (!out.includes(url.href)) out.push(url.href);
  }
  if (out.length > MAX_POOL_SIZE) throw new Error(`RPC pool exceeds ${MAX_POOL_SIZE} nodes`);
  return out.length ? out : fallback.slice();
}

// Eight observers cost at most 40 walk tokens, below the 60-token burst.
export const MAX_POOL_SIZE = 8;

export function parsePools(env) {
  const e = env || {};
  const archivals = parseList(e.EXPLORER_ARCHIVALS, DEFAULT_ARCHIVALS);
  const fleet = parseList(e.EXPLORER_FLEET, DEFAULT_FLEET);
  // Refuse an ambiguous role instead of quietly making a validator an observer.
  const host = u => new URL(u).hostname.replace(/\.nip\.io$/, '');
  const fleetHosts = new Set([...fleet, ...DEFAULT_FLEET].map(host));
  if (archivals.some(u => fleetHosts.has(host(u)))) {
    throw new Error('An archival RPC cannot also be a fleet validator');
  }
  return { archivals, fleet };
}

/** Per-upstream cooldown, isolate-local. `url -> coolingUntilEpochMs`. */
const cooldowns = new Map();
const observations = new Map();
const MAX_OBSERVATIONS = 64;
export const OBSERVATION_FRESH_MS = 60_000;

function record(url, req, outcome, start, at) {
  const old = observations.get(url);
  if (!old && observations.size >= MAX_OBSERVATIONS) observations.delete(observations.keys().next().value);
  const rpcCode = outcome.value?.error?.code;
  const supported = outcome.settled ? rpcCode !== -32601 : null;
  const methods = { ...old?.methods, [req.method]: { supported, sampled_at: at } };
  const data = outcome.value?.result;
  const safe = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const sample = {
    ...old, at, latency_ms: Math.max(0, at - start),
    responding: outcome.settled,
    requests: (old?.requests ?? 0) + 1,
    failures: (old?.failures ?? 0) + (outcome.settled ? 0 : 1),
    outcome: outcome.settled ? (rpcCode ? 'rpc_error' : 'ok') : outcome.outcome,
    methods,
  };
  if (req.method === 'getchaininfo' && data && typeof data === 'object') {
    sample.chain = { slot: safe(data.slot), height: safe(data.height), lag_slots: safe(data.behind_by_slots), sampled_at: at };
  }
  if (req.method === 'getbuildinfo' && data && typeof data === 'object') {
    sample.build = Object.fromEntries(['build_version', 'package_version', 'commit', 'commit_source', 'tree_state', 'source_digest', 'source_digest_alg', 'rustc', 'profile', 'target']
      .filter(k => typeof data[k] === 'string').map(k => [k, data[k].slice(0, 256)]));
    sample.build_at = at;
  }
  observations.set(url, sample);
}

/** Passive measurements only. Never probes; never exposes upstream addresses. */
export function poolSnapshot(pools, now) {
  return ['archivals', 'fleet'].flatMap(role => pools[role].map((url, i) => {
    const o = observations.get(url);
    const age = o ? Math.max(0, now - o.at) : null;
    return {
      id: `${role === 'archivals' ? 'archival' : 'witness'}-${i + 1}`,
      role: role === 'archivals' ? 'observer' : 'witness',
      status: !o ? 'unobserved' : age > OBSERVATION_FRESH_MS ? 'stale' : o.responding ? 'responding' : 'unavailable',
      sampled_at: o?.at ?? null, age_ms: age, latency_ms: o?.latency_ms ?? null,
      requests: o?.requests ?? 0, failures: o?.failures ?? 0,
      cooling: isCooling(url, now), outcome: o?.outcome ?? null,
      methods: o?.methods ?? {}, chain: o?.chain ?? null,
      build: o?.build ?? null, build_sampled_at: o?.build_at ?? null,
    };
  }));
}

export const COOLDOWN_MS = 15_000;

export function markSick(url, now) {
  cooldowns.set(url, now + COOLDOWN_MS);
}
export function markWell(url) {
  cooldowns.delete(url);
}
export function isCooling(url, now) {
  return (cooldowns.get(url) || 0) > now;
}
export function _resetPoolForTests() {
  cooldowns.clear();
  observations.clear();
}

/**
 * Healthy first, cooling after — never dropped.
 *
 * A cooling upstream is still tried when nothing else is left: with two
 * archivals, "both are sick" must still mean "ask one", because refusing to
 * try is a worse answer than a slow one.
 */
export function order(urls, now) {
  const healthy = [];
  const cooling = [];
  for (const u of urls) (isCooling(u, now) ? cooling : healthy).push(u);
  return { order: healthy.concat(cooling), allCooling: healthy.length === 0 };
}

export const ATTEMPT_TIMEOUT_MS = 9_000;

/**
 * One call against one upstream. Never throws.
 *
 * `{ settled: true, value: {result}|{error} }`  an answer for the caller
 * `{ settled: false, outcome }`                 ask someone else
 *
 * -32004 (NODE_UNAVAILABLE) and -32603 are treated as "ask someone else"
 * rather than as answers: the node returns them when its consensus thread did
 * not reply inside ENGINE_TIMEOUT, which is a statement about that node's
 * schedule and not about the chain.
 */
const RETRYABLE_RPC_CODES = new Set([-32004, -32603]);

export async function attemptOne(url, rpcReq, timeoutMs, fetchImpl, now = Date.now) {
  const start = now();
  const done = outcome => { record(url, rpcReq, outcome, start, now()); return outcome; };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpcReq),
      signal: ac.signal,
    });
    if (!res.ok) return done({ settled: false, outcome: `http ${res.status}` });
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return done({ settled: false, outcome: 'non-json response' });
    }
    if (parsed && parsed.error && typeof parsed.error.code === 'number') {
      if (RETRYABLE_RPC_CODES.has(parsed.error.code)) {
        return done({ settled: false, outcome: `rpc ${parsed.error.code}` });
      }
      return done({ settled: true, value: { error: parsed.error } });
    }
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'result')) {
      return done({ settled: true, value: { result: parsed.result } });
    }
    return done({ settled: false, outcome: 'malformed json-rpc response' });
  } catch (e) {
    return done({
      settled: false,
      outcome: e && e.name === 'AbortError' ? 'timeout' : 'network error',
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Order-independent key for comparing two answers.
 *
 * Borrowed verbatim in spirit from `functions/g4rpc.js`: a false DISAGREEMENT
 * costs a reader an "unavailable" while the chain is fine, so key order must
 * never be read as a fork.
 */
export function canonicalKey(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalKey).join(',') + ']';
  return (
    '{' +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalKey(v[k]))
      .join(',') +
    '}'
  );
}
