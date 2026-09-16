import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateManifest, editionAt, collectActivity, publishWeek } from './model.mjs';
import { render } from './render.mjs';
const first = JSON.parse(await readFile(new URL('./release-1.json', import.meta.url)));
const manifest = validateManifest(first.manifest);
function memory() { const data = new Map([['roadmap:current', JSON.stringify(manifest)]]); return { data, async get(k, type) { const v = data.get(k); return type === 'json' && v ? JSON.parse(v) : v || null; }, async put(k,v) { data.set(k,v); } }; }
const good = async () => Response.json([{ sha: 'a'.repeat(40), commit: { message: 'Implement a bounded transition\nDetails' } }]);
test('weekly dates start with Release 2 on the following Wednesday at 21 UTC', () => {
 assert.equal(editionAt(Date.parse('2026-09-16T21:00:00Z')), null);
 assert.equal(editionAt(Date.parse('2026-09-22T21:00:00Z')), null);
 assert.equal(editionAt(Date.parse('2026-09-23T20:59:59Z')), null);
 assert.deepEqual(editionAt(Date.parse('2026-09-23T21:00:00Z')), { number: 2, date: '2026-09-23' });
 assert.deepEqual(editionAt(Date.parse('2026-09-30T21:00:00Z')), { number: 3, date: '2026-09-30' });
});
test('scheduler archives once and preserves reviewed status without promoting it', async () => {
 const RELEASES = memory(); const ts = Date.parse('2026-09-23T21:00:00Z');
 const report = await publishWeek({ RELEASES },ts,good);
 assert.equal(report.number,2); assert.equal(report.manifest.reviewed_on,'2026-09-16');
 assert.equal(report.manifest.tracks[0].status,'Validation pending');
 const before = RELEASES.data.get('release:000002');
 assert.equal((await publishWeek({ RELEASES },ts,()=>{throw Error('Must not fetch');})).skipped,'edition already archived');
 assert.equal(RELEASES.data.get('release:000002'),before);
 assert.equal(RELEASES.data.get('latest'),'2');
});
test('unavailable sources are explicit and do not become zero progress', async () => {
 const result = await collectActivity(manifest.sources[0],'2026-09-16','2026-09-23',async()=>new Response('',{status:429}));
 assert.equal(result.available,false); assert.equal(result.count,undefined);
 const RELEASES=memory(); const r=await publishWeek({RELEASES},Date.parse('2026-09-23T21:00:00Z'),async()=>new Response('',{status:404}));
 assert(r.activity.every(a=>!a.available));
 assert.match(render(r,[{number:2,date:r.date}]),/Source is not publicly available/);
});
test('invalid metadata cannot publish or advance latest', async () => {
 const RELEASES=memory(); RELEASES.data.set('roadmap:current','{}');
 await assert.rejects(publishWeek({RELEASES},Date.parse('2026-09-23T21:00:00Z'),good),/Invalid roadmap/);
 assert.equal(RELEASES.data.has('latest'),false);
});
test('archive preserves dates and escapes untrusted commit titles and references', () => {
 const r=structuredClone(first);r.activity=[{label:'<script>',repo:'x/y',ref:'main',available:true,count:1,commits:[{title:'<img src=x onerror=alert(1)>',url:'javascript:alert(1)',sha:'b'.repeat(40)}]}];
 const html=render(r,[{number:1,date:'2026-09-16'}],Date.parse('2026-09-16'));
 assert.match(html, /Release 1/);assert.match(html,/September 16, 2026/);
 assert(!html.includes('<script>'));assert(!html.includes('href="javascript:'));
 assert.match(html,/&lt;img/);assert.match(html,/href="#"/);
});
test('old latest edition is visibly overdue, not silently dated today', () => {
 const html=render(first,[{number:1,date:first.date}],Date.parse('2026-10-10'));
 assert.match(html,/overdue/);assert.match(html,/datetime="2026-09-16"/);
});
test('100-commit sample is marked as truncated', async () => {
 const r=await collectActivity(manifest.sources[0],'a','b',async()=>Response.json(Array.from({length:100},()=>({sha:'c'.repeat(40),commit:{message:'Update'}}))));
 assert.equal(r.truncated,true);assert.equal(r.count,100);assert.equal(r.commits.length,8);
});
test('retry repairs latest pointer after an interrupted publication', async () => {
 const RELEASES=memory();const put=RELEASES.put;let fail=true;
 RELEASES.put=async(k,v)=>{if(k==='latest'&&fail){fail=false;throw Error('interrupted');}await put(k,v);};
 const ts=Date.parse('2026-09-23T21:00:00Z');
 await assert.rejects(publishWeek({RELEASES},ts,good),/interrupted/);
 assert(RELEASES.data.has('release:000002'));assert(!RELEASES.data.has('latest'));
 await publishWeek({RELEASES},ts,()=>{throw Error('Must not fetch');});
 assert.equal(RELEASES.data.get('latest'),'2');
});
// Replace only bundler text/JSON imports; execute the actual fetch handler.
let workerSource=await readFile(new URL('./worker.mjs',import.meta.url),'utf8');
workerSource=workerSource.replace("import first from './release-1.json';",`const first=${JSON.stringify(first)};`).replace("import css from './style.css';","const css='body{}';").replace("'./model.mjs'",JSON.stringify(new URL('./model.mjs',import.meta.url).href)).replace("'./render.mjs'",JSON.stringify(new URL('./render.mjs',import.meta.url).href));
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(workerSource).toString('base64'));
function env(){const RELEASES=memory();RELEASES.list=async()=>({keys:[{name:'release:000001'}],list_complete:true});return {RELEASES};}
test('actual fetch handler serves dated edition, JSON, HEAD and CSS',async()=>{
 const e=env();for(const path of ['/releases','/releases/','/releases/1']){const r=await worker.fetch(new Request('https://posternlabs.com'+path),e);assert.equal(r.status,200);assert.match(await r.text(),/September 16, 2026/);}
 const r=await worker.fetch(new Request('https://posternlabs.com/releases/1.json'),e);assert.equal((await r.json()).number,1);
 assert.equal(await (await worker.fetch(new Request('https://posternlabs.com/releases',{method:'HEAD'}),e)).text(),'');
 assert.equal(await (await worker.fetch(new Request('https://posternlabs.com/releases/style.css'),e)).text(),'body{}');
});
test('public routes cannot trigger publication or expose non-release KV records',async()=>{
 const e=env();for(const path of ['/releases/2','/releases/roadmap:current','/releases/admin','/g4rpc'])assert.equal((await worker.fetch(new Request('https://posternlabs.com'+path),e)).status,404);
 assert.equal((await worker.fetch(new Request('https://posternlabs.com/releases',{method:'POST'}),e)).status,405);
 assert.equal(e.RELEASES.data.size,1);
});
test('archive failure returns 503 instead of pretending the old edition is current',async()=>{
 const r=await worker.fetch(new Request('https://posternlabs.com/releases'),{RELEASES:{get:async()=>{throw Error('offline');}}});assert.equal(r.status,503);
});
