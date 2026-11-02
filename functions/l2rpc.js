// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cloudflare Pages Function: /l2rpc  (blochl1.com, Pages project bloch-explorer)
//
// The read endpoint of the /l2 explorer pages (Bloch L2, chain id 700770).
// POST: allowlisted, read-only JSON-RPC forwarded to L2_RPC_URL with a chain-id
// guard. GET: a description of the endpoint. Policy lives in edge/l2rpc.js.
//
// Config (wrangler.toml [vars]):
//   L2_RPC_URL   public L2 RPC, e.g. https://l2rpc.blochl1.com/ (space-separated
//                list = fallbacks). Must not be a bare IP (Cloudflare answers
//                1003 to a Worker fetch of an IP literal).
//   L2_CHAIN_ID  expected chain id, default 700770.
import { handleL2Rpc, describeL2Rpc } from '../edge/l2rpc.js';

export async function onRequestPost(context) {
  return handleL2Rpc(context.request, context.env);
}

export async function onRequestGet(context) {
  return describeL2Rpc(context.env);
}

export async function onRequest() {
  return new Response(JSON.stringify({ error: 'method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'GET, POST' },
  });
}
