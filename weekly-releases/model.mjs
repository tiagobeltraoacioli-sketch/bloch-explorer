export const FIRST_DATE = '2026-09-16';
export const CRON = '0 21 * * WED';
const DAY = 86400000;
const states = new Set(['Published', 'Validation pending', 'In development', 'Integration testing']);
export function validateManifest(m) {
  if (m?.schema !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(m.reviewed_on) || !Array.isArray(m.tracks) || m.tracks.length !== 6 || !Array.isArray(m.roadmap) || !Array.isArray(m.sources)) throw new Error('Invalid roadmap');
  if (!m.title || !m.summary || !Array.isArray(m.highlights) || !/^[a-f0-9]{40}$/.test(m.published_node?.commit)) throw new Error('Invalid release metadata');
  for (const track of m.tracks) if (!states.has(track.status) || !track.name || !track.current || !track.next || !track.evidence) throw new Error('Invalid workstream');
  for (const source of m.sources) if (!/^[\w.-]+\/[\w.-]+$/.test(source.repo) || typeof source.ref !== 'string' || !source.ref || !source.label) throw new Error('Invalid repository source');
  return m;
}
export function editionAt(timestamp) {
  const instant = new Date(timestamp);
  const date = instant.toISOString().slice(0, 10);
  const days = Math.floor((Date.parse(date) - Date.parse(FIRST_DATE)) / DAY);
  if (days < 7 || days % 7 !== 0 || instant.getUTCHours() < 21) return null;
  return { number: 1 + days / 7, date };
}
export async function collectActivity(source, since, until, fetcher = fetch) {
  const base = `https://api.github.com/repos/${source.repo}/commits`;
  const query = new URLSearchParams({ sha: source.ref, since, until, per_page: '100' });
  try {
    const response = await fetcher(`${base}?${query}`, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Postern-Weekly-Releases' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid repository response');
    const commits = rows.map(row => {
      if (!/^[a-f0-9]{40}$/.test(row.sha) || typeof row.commit?.message !== 'string') throw new Error('Invalid commit');
      return { sha: row.sha, title: row.commit.message.split('\n')[0].slice(0, 220), url: `https://github.com/${source.repo}/commit/${row.sha}` };
    });
    return { ...source, available: true, count: commits.length, truncated: commits.length === 100, commits: commits.slice(0, 8) };
  } catch (error) {
    return { ...source, available: false, error: error.message, commits: [] };
  }
}
export async function publishWeek(env, timestamp, fetcher = fetch) {
  const edition = editionAt(timestamp);
  if (!edition) return { skipped: 'outside weekly publication window' };
  const key = `release:${String(edition.number).padStart(6, '0')}`;
  if (await env.RELEASES.get(key)) {
    // Repair an interrupted archive/index write without changing the edition.
    if (Number(await env.RELEASES.get('latest') || 0) < edition.number) await env.RELEASES.put('latest', String(edition.number));
    return { skipped: 'edition already archived' };
  }
  const manifest = validateManifest(await env.RELEASES.get('roadmap:current', 'json'));
  if (manifest.reviewed_on > edition.date) throw new Error('Roadmap review is in the future');
  const until = new Date(timestamp).toISOString();
  const since = new Date(timestamp - 7 * DAY).toISOString();
  const activity = await Promise.all(manifest.sources.map(source => collectActivity(source, since, until, fetcher)));
  const report = { ...edition, published_at: until, kind: 'scheduled-repository-report', manifest, activity, activity_period: { since, until }, activity_note: 'Repository activity is collected automatically. Roadmap readiness retains its last engineering review date; commit activity is not deployment or test evidence.' };
  // Write the complete immutable edition before moving the latest pointer.
  await env.RELEASES.put(key, JSON.stringify(report));
  await env.RELEASES.put('latest', String(edition.number));
  await env.RELEASES.put('scheduler:last-success', JSON.stringify({ number: edition.number, published_at: until, sources_available: activity.filter(a => a.available).length }));
  return report;
}
export function escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function safeURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' ? escape(u.href) : '#'; } catch { return '#'; }
}
export function dateLabel(date) { return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); }
