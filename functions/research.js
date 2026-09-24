// SPDX-License-Identifier: AGPL-3.0-or-later
// Bloch Space's BLCH series is sourced from this explorer's peer-history API.
// Reuse its producer directly: explorer -> Space -> explorer would re-enter the
// same Cloudflare Worker. Keep the Space-compatible envelope and name the origin.
import { handlePeerHistory } from '../edge/observability.js';
const headers = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
export async function onRequest({ request, env }) {
  const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });
  if (request.method !== 'GET') return reply(405, { error: 'GET required.' });
  const query = new URL(request.url).searchParams;
  const period = query.get('period') || '24h';
  if (!['6h', '24h', '7d'].includes(period) || [...query.keys()].some(key => key !== 'period') || query.getAll('period').length > 1)
    return reply(400, { error: 'Choose period 6h, 24h or 7d.' });
  const result = await handlePeerHistory(env, { period });
  const data = result.body?.data;
  if (result.status !== 200 || !data) return reply(503, { error: 'Shared Bloch Space telemetry unavailable. Retry shortly.' });
  return new Response(JSON.stringify({
    network: 'bloch', source: 'Bloch monitored-node observability (shared with Bloch Space)',
    source_url: `https://blochl1.com/api/v1/observability/peer-history?period=${period}`,
    compatible_with: `https://bloch.space/api/series?network=bloch&range=${period}`,
    delivery: 'shared_source_direct', retrieved_at: new Date(result.body.sampled_at).toISOString(),
    independent_verification: false,
    note: 'Same telemetry producer used by Bloch Space. Aggregate sockets, not unique peers; gaps and reporting coverage are preserved.',
    period, points: data.points, returned: data.points.length, valid_points: data.valid_points,
  }), { headers: { ...headers, 'cache-control': 'public, max-age=30, s-maxage=60' } });
}
