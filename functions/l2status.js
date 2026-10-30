// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cloudflare Pages Function: GET /l2status  (blochl1.com, Pages project bloch-explorer)
//
// The Bloch L2 settlement record (activation, accepted settlement, deposit
// inbox and escrow, withdrawals, attestor set) as the L1 holds it, read with
// `getl2settlement` from the explorer's L1 observers (EXPLORER_ARCHIVALS and
// EXPLORER_FLEET, see edge/pool.js) and served with how many of them agree.
// Policy in edge/l2status.js. L2_CHAIN_ID (default 700770) is the expected id.
import { handleL2Status } from '../edge/l2status.js';

export async function onRequestGet(context) {
  return handleL2Status(context.env);
}

export async function onRequest() {
  return new Response(JSON.stringify({ error: 'method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'GET' },
  });
}
