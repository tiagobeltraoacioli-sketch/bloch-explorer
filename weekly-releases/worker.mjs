import first from './release-1.json';
import css from './style.css';
import { publishWeek } from './model.mjs';
import { render } from './render.mjs';
const headers = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'cache-control': 'public, max-age=60', 'content-security-policy': "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
function reply(body, type, status, head) { return new Response(head ? null : body, { status, headers: { ...headers, 'content-type': type } }); }
export default {
  async scheduled(controller, env, ctx) { ctx.waitUntil(publishWeek(env, controller.scheduledTime)); },
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const url = new URL(request.url), head = request.method === 'HEAD';
    const path = url.pathname.replace(/\/$/, '');
    if (path === '/releases/style.css') return reply(css, 'text/css; charset=utf-8', 200, head);
    const match = path.match(/^\/releases(?:\/([1-9]\d{0,5})(\.json)?)?$/);
    if (!match) return reply('Not found', 'text/plain', 404, head);
    try {
      const latest = await env.RELEASES.get('latest');
      const number = Number(match[1] || latest || 1);
      const archived = await env.RELEASES.get(`release:${String(number).padStart(6, '0')}`, 'json');
      const report = archived || (number === 1 ? first : null);
      if (!report) return reply('Release not found', 'text/plain', 404, head);
      if (match[2]) return reply(JSON.stringify(report, null, 2), 'application/json; charset=utf-8', 200, head);
      const archive = [{ number: 1, date: first.date }];
      let cursor;
      do {
        const page = await env.RELEASES.list({ prefix: 'release:', limit: 1000, ...(cursor ? { cursor } : {}) });
        for (const key of page.keys) {
          const n = Number(key.name.split(':')[1]);
          if (n !== 1) archive.push({ number: n, date: new Date(Date.parse(first.date) + (n - 1) * 7 * 86400000).toISOString().slice(0, 10) });
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return reply(render(report, archive), 'text/html; charset=utf-8', 200, head);
    } catch {
      return reply('The release archive is temporarily unavailable. Please try again.', 'text/plain; charset=utf-8', 503, head);
    }
  }
};
