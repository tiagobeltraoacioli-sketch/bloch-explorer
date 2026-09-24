// SPDX-License-Identifier: AGPL-3.0-or-later
// A fixed public Bloch Space source, not a general-purpose URL proxy.
const headers = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
export async function onRequest({ request }) {
  const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });
  if (request.method !== 'GET') return reply(405, { error: 'GET required.' });
  const query = new URL(request.url).searchParams;
  const period = query.get('period') || '24h';
  if (!['6h', '24h', '7d'].includes(period) || [...query.keys()].some(key => key !== 'period') || query.getAll('period').length > 1)
    return reply(400, { error: 'Choose period 6h, 24h or 7d.' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(`https://bloch.space/api/series?network=bloch&range=${period}`, {
      signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!upstream.ok || !upstream.headers.get('content-type')?.includes('application/json')) throw new Error('Source unavailable');
    const reader = upstream.body.getReader();
    const chunks = []; let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 256 * 1024) { await reader.cancel(); throw new Error('Source too large'); }
      chunks.push(value);
    }
    const data = JSON.parse(await new Blob(chunks).text());
    if (data.network !== 'bloch' || data.period !== period || !Array.isArray(data.points) || data.points.length > 169)
      throw new Error('Invalid source');
    return new Response(JSON.stringify(data), { headers: { ...headers, 'cache-control': 'public, max-age=60' } });
  } catch { return reply(503, { error: 'Bloch Space series unavailable. Retry shortly.' }); }
  finally { clearTimeout(timeout); }
}
