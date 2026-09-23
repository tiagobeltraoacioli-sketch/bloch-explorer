// Create a dated editorial edition before the weekly cron when publication is
// explicitly requested. Upload the JSON archive before moving the KV pointer.
import { readFile, writeFile } from 'node:fs/promises';
import { collectActivity, validateManifest } from './model.mjs';

const prior = JSON.parse(await readFile(new URL('./release-1.json', import.meta.url)));
const manifest = validateManifest(JSON.parse(await readFile(new URL('./roadmap.json', import.meta.url))));
const publishedAt = new Date().toISOString();
const date = publishedAt.slice(0, 10);
if (date !== '2026-09-23' || manifest.reviewed_on !== date) throw new Error('Review date and release date must match 2026-09-23');
const since = prior.published_at;
const activity = await Promise.all(manifest.sources.map(source => collectActivity(source, since, publishedAt)));
const report = {
  number: 2,
  date,
  published_at: publishedAt,
  kind: 'reviewed-development-report',
  manifest,
  activity,
  activity_period: { since, until: publishedAt },
  activity_note: 'Public GitHub activity was collected since Release 1. The dated engineering review also uses local source and deployment records; local or private commits are not included in public activity counts. Unavailable sources are not zero-commit sources.',
};
await writeFile(new URL('./release-2.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`Release 2 collected through ${publishedAt}: ${activity.filter(item => item.available).length}/${activity.length} public sources available`);
