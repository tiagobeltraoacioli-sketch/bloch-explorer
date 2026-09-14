// SPDX-License-Identifier: AGPL-3.0-or-later
import { handleRead, buildOpts, runtimeFor, capabilitiesJson } from '../edge/core.js';
import { methodSpec } from '../edge/surface.js';
import { Bucket, clientBucket, clientKey, NO_QUORUM, RATE_LIMITED } from '../edge/governor.js';

export const VERSION = '2.0.0';
export const SUBMISSION_UNKNOWN = -32052;
export const MAX_BODY = 1024 * 1024;
const MAX_REPLY = 2 * MAX_BODY;
const BODY_TIMEOUT_MS = 10_000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'retry-after, x-gateway-version, x-edge-corroboration',
  'access-control-max-age': '600',
};
let broadcastBudget;
let broadcastsInFlight = 0;
export function resetGatewayForTests() { broadcastBudget = undefined; broadcastsInFlight = 0; }

function fault(id, code, message, reason, extra = {}) {
  return { jsonrpc: '2.0', id, error: { code, message, data: { reason, ...extra } } };
}
function reply(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'x-gateway-version': VERSION, ...extra,
  } });
}

// Enforce byte limits while reading, including bodies without Content-Length.
export async function readBounded(stream, limit, timeoutMs = BODY_TIMEOUT_MS) {
  if (!stream) return '';
  const reader = stream.getReader();
  let timer;
  const chunks = [];
  let length = 0;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(new Error('body_timeout')); void reader.cancel().catch(() => {}); }, timeoutMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('body_too_large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

function validRequest(p) {
  return p && !Array.isArray(p) && p.jsonrpc === '2.0' && typeof p.method === 'string' &&
    Object.hasOwn(p, 'id') && (p.id === null || typeof p.id === 'string' || Number.isSafeInteger(p.id)) &&
    (p.params === undefined || p.params !== null && typeof p.params === 'object');
}

function validReply(value, id) {
  return value && value.jsonrpc === '2.0' && value.id === id &&
    Object.hasOwn(value, 'result') !== Object.hasOwn(value, 'error') &&
    (!Object.hasOwn(value, 'error') || value.error && Number.isInteger(value.error.code) && typeof value.error.message === 'string');
}

export function enforceReadQuorum(out, payload) {
  const spec = methodSpec(payload.method);
  if (!['quorum', 'lineage'].includes(spec?.corroboration) || out.body?.error) return out;
  const c = out.corroboration;
  if (out.cacheState !== 'stale' && ['corroborated', 'final'].includes(c?.level) &&
      c.archival_witnesses >= 2 && c.fleet_witness === true) return out;
  return { status: 200, cacheState: 'bypass', body: fault(payload.id, NO_QUORUM,
    'No fresh read quorum. Withhold settlement and retry with backoff.', 'no_read_quorum',
    { quorum_required: 2, retryable: true, missing: c?.missing || ['fresh corroboration unavailable'] }) };
}

async function broadcast(payload, opts, env) {
  const raw = Array.isArray(payload.params) ? payload.params[0] : payload.params?.hex;
  if (typeof raw !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(raw)) {
    return reply(fault(payload.id, -32602, 'Expected an even-length hexadecimal transaction.', 'invalid_params'), 400);
  }
  // One authoritative admission response. Never retry or fan out a write after
  // a timeout: it may already have been admitted. Node errors remain intact.
  const upstream = env.BROADCAST_UPSTREAM || opts.pools.archivals[0];
  if (!opts.pools.archivals.includes(upstream)) {
    return reply(fault(payload.id, -32603, 'Broadcast upstream must be in the configured observer pool.', 'gateway_configuration'), 503);
  }
  broadcastBudget ||= new Bucket(4, 2, opts.now);
  if (broadcastsInFlight >= 2 || !broadcastBudget.take(1)) {
    return reply(fault(payload.id, RATE_LIMITED, 'Broadcast capacity reached; retry with backoff.', 'broadcast_rate_limited'), 429, { 'retry-after': '1' });
  }
  broadcastsInFlight++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await opts.fetchImpl(upstream, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal, redirect: 'manual',
    });
    if (!response.ok) throw new Error('upstream_http_error');
    const value = JSON.parse(await readBounded(response.body, MAX_REPLY));
    if (!validReply(value, payload.id)) {
      throw new Error('invalid_upstream_reply');
    }
    return reply(value);
  } catch {
    return reply(fault(payload.id, SUBMISSION_UNKNOWN,
      'Submission outcome is unknown. Reconcile transaction status before retrying the same signed bytes; do not build a second payment.',
      'submission_unknown', { retryable: false, admission_unknown: true }), 200);
  } finally { clearTimeout(timer); broadcastsInFlight--; }
}

export async function handleGateway(request, env = {}, context = {}, overrides = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/g4rpc' && url.pathname !== '/g4rpc/') {
    // A route pattern may also match /g4rpc-other. Preserve existing Pages
    // handling rather than capturing website or download paths.
    return (overrides.fetchImpl || fetch)(request);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return reply(fault(null, -32600, 'Use POST.', 'method_not_allowed'), 405, { allow: 'POST, OPTIONS' });
  const runtime = { ...runtimeFor(context), ...overrides };
  if (!clientBucket('gateway:' + clientKey(request), runtime.now).take(1)) {
    return reply(fault(null, RATE_LIMITED, 'Request rate exceeded.', 'rate_limited'), 429, { 'retry-after': '1' });
  }
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply(fault(null, -32600, 'Content-Type must be application/json.', 'unsupported_media_type'), 415);
  }
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) {
    return reply(fault(null, -32600, 'Request exceeds the 1 MiB limit.', 'body_too_large'), 413);
  }
  let payload;
  try { payload = JSON.parse(await readBounded(request.body, MAX_BODY)); }
  catch (e) {
    const status = e.message === 'body_too_large' ? 413 : e.message === 'body_timeout' ? 408 : 400;
    return reply(fault(null, -32700, 'Invalid or unreadable JSON request.', status === 413 ? 'body_too_large' : 'parse_error'), status);
  }
  if (!validRequest(payload)) return reply(fault(null, -32600, 'Expected one JSON-RPC 2.0 call with an id; batches and notifications are not supported.', 'invalid_request'), 400);
  if (!methodSpec(payload.method) && payload.method !== 'sendrawtransaction') return reply(fault(payload.id, -32601, 'Method is not exposed by this gateway; consult getcapabilities.', 'method_not_allowed'));
  if (payload.method === 'getcapabilities') {
    const caps = capabilitiesJson(runtime.now());
    return reply({ jsonrpc: '2.0', id: payload.id, result: {
      ...caps, edge: 'bloch-g4-rpc', version: VERSION, surface: 'genesis-4-gateway',
      methods: [...caps.methods, { name: 'sendrawtransaction', cache_class: 'never', corroboration: 'node_local' }],
      absent: caps.absent.filter(({ name }) => name !== 'sendrawtransaction'),
      error_codes: { ...caps.error_codes, submission_unknown: SUBMISSION_UNKNOWN },
      strict_read_quorum: true, independent_operator_verification: false,
      broadcast_policy: 'single_observer_no_automatic_retry',
      limits: { ...caps.limits, request_body_bytes: MAX_BODY, notifications: false,
        broadcast_per_second_per_isolate: 2, broadcast_concurrency_per_isolate: 2 },
    } });
  }
  try {
    const opts = buildOpts(env, request, runtime);
    if (payload.method === 'sendrawtransaction') return await broadcast(payload, opts, env);
    const readOpts = { ...opts, fetchImpl: async (input, init) => {
      const response = await opts.fetchImpl(input, { ...init, redirect: 'manual' });
      return { ok: response.ok, status: response.status, text: async () => {
        // Empty runtime bodies and lightweight injected test transports.
        const text = response.body ? await readBounded(response.body, MAX_REPLY) : await response.text();
        if (new TextEncoder().encode(text).byteLength > MAX_REPLY) throw new Error('body_too_large');
        if (!validReply(JSON.parse(text), JSON.parse(init.body).id)) throw new Error('invalid_upstream_reply');
        return text;
      } };
    } };
    const out = enforceReadQuorum(await (overrides.handleRead || handleRead)(payload, readOpts), payload);
    const body = { ...out.body, corroboration: out.corroboration || null };
    if (body.result && typeof body.result === 'object' && !Array.isArray(body.result)) {
      body.result = { ...body.result, corroboration: out.corroboration || null };
    }
    return reply(body, out.status === 429 ? 429 : 200, {
      'x-edge-corroboration': out.corroboration?.level || 'none',
      ...(out.retryAfterMs !== undefined ? { 'retry-after': String(Math.ceil(out.retryAfterMs / 1000)) } : {}),
    });
  } catch {
    return reply(fault(payload.id, -32603, 'Gateway could not complete the request.', 'gateway_unavailable'), 503);
  }
}
export default { fetch: handleGateway };
