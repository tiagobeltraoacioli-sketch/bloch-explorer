// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cloudflare Pages Function: POST /rpc  (blochl1.com, Pages project bloch-explorer)
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT REPLACED WHAT, AND WHY IT MATTERED
// ═══════════════════════════════════════════════════════════════════════════
//
// Until this rewrite this file was a Genesis-3 passthrough: an allowlist of
// `gethashrate`, `getsupplydistribution`, `getdifficultyhistory` and twenty
// more proof-of-work names, forwarding to a single archival node at
// `BLOCH_RPC_URL`. Its own comment admitted the drift — "NOTE (Genesis-4): the
// allowlist below is the Genesis-3 surface … several methods here die with PoW
// and the new staking/finality methods are absent" — and the note survived
// three weeks past the relaunch. Genesis-3 stopped at height 39,918 on
// 2026-08-13. Every method in that allowlist has been answering -32601, or
// nothing at all, ever since.
//
// A stale allowlist is not a cosmetic problem. It is a list of promises about
// what a public endpoint will and will not forward, and one that has stopped
// matching the chain has stopped being a control.
//
// Three things changed, not one:
//
//  1. THE SURFACE IS FROZEN ACROSS THE LANGUAGE BOUNDARY. The allowlist now
//     lives in `edge/surface.js` and `edge/tests/surface-frozen.test.mjs`
//     reads `RPC_SURFACE` out of `crates/bloch-pos-node/src/rpc.rs` — the
//     dispatcher's own source, not a copy — and asserts in both directions:
//     no edge method that the node does not have, no node method silently
//     dropped without a written reason. That is the same freeze the node's
//     `the_rpc_method_namespace_is_frozen` gives Rust callers, extended to the
//     edge, so this file cannot drift a whole chain generation again without a
//     test going red.
//
//  2. IT IS NO LONGER A PASSTHROUGH. It caches on immutability, coalesces
//     concurrent identical calls, meters callers, and — the part that actually
//     protects the chain — caps the calls it is willing to MAKE regardless of
//     how many it receives. See `edge/governor.js`.
//
//  3. IT READS FROM THE ARCHIVALS AND CORROBORATES AGAINST THE FLEET. Never
//     the other way round. See `edge/pool.js`.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THE EDGE HAS TO DO THIS AT ALL
// ═══════════════════════════════════════════════════════════════════════════
//
// From `crates/bloch-pos-node/src/rpc.rs`, in the node's own words:
//
//     "## Authentication: there is none
//      No API key, no rate limit, no per-method authorisation … That is why
//      `--rpc-bind` defaults to 127.0.0.1 … The bounds that ARE here are
//      anti-exhaustion, not authorisation … They stop one client from
//      consuming the node; they stop no one from reading it."
//
// And the port is served from the consensus thread: a request that arrives
// while a proposal is being signed waits for that signature. An explorer is by
// construction a load generator pointed at that port. This file is the thing
// that stands between the two.
//
// Config: EXPLORER_ARCHIVALS / EXPLORER_FLEET (see edge/pool.js). Both have
// defaults in the repo, so a missing variable degrades to the documented pool
// rather than to a 503 — the Genesis-3 version's "explicit 503 when unset" was
// right for a single secret upstream and wrong for a public, reviewable list.

import { handleRead, buildOpts, runtimeFor } from '../edge/core.js';
import { counters } from '../edge/governor.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
  'access-control-expose-headers':
    'x-edge-cache, x-edge-age-ms, x-edge-corroboration, x-edge-salt, retry-after',
};

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  ...CORS,
};

/** One read call contains only a method and small scalar parameters. */
export const MAX_RPC_BODY_BYTES = 16 * 1024;

async function readBoundedJson(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RPC_BODY_BYTES) return { tooLarge: true };

  const reader = request.body?.getReader?.();
  if (!reader) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RPC_BODY_BYTES) return { tooLarge: true };
    return { payload: JSON.parse(text) };
  }

  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RPC_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { payload: JSON.parse(text) };
}

function transportError(status, code, message, reason) {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: { code, message, data: { reason } },
  }), { status, headers: JSON_HEADERS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export function respond(out) {
  const headers = {
    ...JSON_HEADERS,
    'x-edge-cache': out.cacheState || 'bypass',
    'x-edge-corroboration': (out.corroboration && out.corroboration.level) || 'none',
  };
  if (out.ageMs !== undefined) headers['x-edge-age-ms'] = String(out.ageMs);
  if (out.corroboration?.cache_salt !== undefined) {
    headers['x-edge-salt'] = String(out.corroboration.cache_salt);
  }
  if (out.retryAfterMs !== undefined) {
    headers['retry-after'] = String(Math.ceil(out.retryAfterMs / 1000));
  }
  // The corroboration ships INSIDE the result envelope too, not only as a
  // header: a JSON-RPC client reads `body.result`, and a caller that has to
  // read a response header to find out whether the number is trustworthy will
  // not read it.
  const body = out.body;
  if (body && body.result && typeof body.result === 'object' && !Array.isArray(body.result)) {
    body.result = { ...body.result, corroboration: out.corroboration };
  }
  return new Response(JSON.stringify(body), {
    // JSON-RPC errors ride on 200 so clients parse the body — except the two
    // rate limits, where 429 plus Retry-After is what every HTTP client
    // already knows how to back off from.
    status: out.status === 429 ? 429 : 200,
    headers,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const mediaType = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return transportError(415, -32600, 'content-type must be application/json', 'unsupported_media_type');
  }

  let payload;
  try {
    const read = await readBoundedJson(request);
    if (read.tooLarge) {
      return transportError(413, -32600, `request body exceeds ${MAX_RPC_BODY_BYTES} bytes`, 'body_too_large');
    }
    payload = read.payload;
  } catch {
    return respond({
      body: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error: body is not JSON' } },
      cacheState: 'bypass',
    });
  }

  if (Array.isArray(payload)) {
    // Batching is refused for the reason the whole file exists: one HTTP
    // request that expands into fifty upstream calls is exactly the shape that
    // starves a consensus thread, and it would arrive costing one token.
    return respond({
      body: {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message:
            'batch requests are not supported by this endpoint; send one call per ' +
            'request. A batch is metered as one call and expands into many upstream ' +
            'calls, which is the load pattern this endpoint exists to bound.',
          data: { reason: 'batch_not_supported' },
        },
      },
      cacheState: 'bypass',
    });
  }

  try {
    const out = await handleRead(payload, buildOpts(env, request, runtimeFor(context)));
    return respond(out);
  } catch (error) {
    // Configuration/runtime failures are edge faults, not evidence that the
    // chain is down. Keep the JSON-RPC contract and CORS headers, but do not
    // reflect exception text (which may contain an upstream URL or binding).
    console.error('explorer rpc edge fault:', error?.name || 'Error');
    return respond({
      body: {
        jsonrpc: '2.0',
        id: payload && payload.id !== undefined ? payload.id : null,
        error: {
          code: -32603,
          message: 'internal edge error',
          data: { reason: 'edge_fault', chainStatusKnown: false },
        },
      },
      cacheState: 'bypass',
    });
  }
}

/** GET /rpc — not a call surface; a description of one, plus live counters. */
export async function onRequestGet() {
  return new Response(
    JSON.stringify(
      {
        endpoint: 'POST /rpc',
        surface: 'Genesis-4, read only',
        max_request_body_bytes: MAX_RPC_BODY_BYTES,
        note:
          'JSON-RPC 2.0, one call per request, no batching. Ask getcapabilities ' +
          'for the method table, the cache classes and the corroboration contract.',
        isolate_counters: { ...counters },
      },
      null,
      2,
    ),
    { status: 200, headers: JSON_HEADERS },
  );
}

/** Explicit fallback so unsupported verbs retain JSON and CORS semantics. */
export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message: 'POST required for JSON-RPC calls', data: { reason: 'method_not_allowed' } },
  }), { status: 405, headers: { ...JSON_HEADERS, allow: 'GET, POST, OPTIONS' } });
}
