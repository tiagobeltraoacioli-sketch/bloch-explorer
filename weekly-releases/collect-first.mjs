import { readFile, writeFile } from 'node:fs/promises';
import { collectActivity } from './model.mjs';
const first=JSON.parse(await readFile(new URL('./release-1.json',import.meta.url)));
first.published_at=new Date().toISOString();
first.activity_period={since:'2026-09-09T21:00:00Z',until:first.published_at};
first.activity=await Promise.all(first.manifest.sources.map(s=>collectActivity(s,first.activity_period.since,first.activity_period.until)));
first.activity_note='Release 1 combines a September 16 engineering review with public repository activity since September 9. Local work in progress can be newer than published branches. Unavailable sources are shown explicitly.';
await writeFile(new URL('./release-1.json',import.meta.url),JSON.stringify(first,null,2)+'\n');
console.log(JSON.stringify(first.activity.map(a=>({label:a.label,available:a.available,count:a.count,error:a.error})),null,2));
