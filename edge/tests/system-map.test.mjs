import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseSystemManifest,loadSystemManifest,safeModuleLink,captureSystemPage,sampleGraph,sourceLink} from '../../src/lib/systemMap.ts';
import {evidencePacket,mergeEvidence,filteredEvidence,validateEvidenceCollection} from '../../src/vendor/graphus/system_evidence.js';
import {sample} from './fixtures/system-map-sample.mjs';
const manifest=JSON.parse(await readFile(new URL('./fixtures/system-map.json',import.meta.url),'utf8'));

test('System Map registry resolves dependencies and rejects untrusted actions and malformed identities',()=>{
  const parsed=parseSystemManifest(manifest);assert.equal(parsed.modules.length,44);assert.ok(parsed.connections.length>40);
  for(const mutate of [m=>m.schema_version=99,m=>m.modules[0].id=m.modules[1].id,m=>m.connections[0].from='unknown',m=>m.modules[0].links_by_asset.BTC[0].href='javascript:alert(1)',m=>m.modules[0].links_by_asset.BTC[0].href='https://untrusted.invalid/',m=>m.modules[0].assets=['OTHER'],m=>m.modules[0].limits='x'.repeat(1201)]){const copy=structuredClone(manifest);mutate(copy);assert.throws(()=>parseSystemManifest(copy));}
  assert.equal(safeModuleLink('https://user:password@bloch-graphus.xyz/map'),false);assert.equal(safeModuleLink('http://bloch-graphus.xyz/map'),false);assert.equal(safeModuleLink('https://rednblue.space/portal/?view=analyses'),true);
});
test('Explorer catalog exposes only Bloch modules, actions and resolvable dependencies',async()=>{
  const scoped=await loadSystemManifest(new AbortController().signal,async()=>new Response(JSON.stringify(manifest)));
  assert.deepEqual(scoped.assets,['BLCH']);assert.equal(scoped.modules.length,35);
  assert.ok(scoped.modules.some(n=>n.id==='blch-source'));assert.ok(scoped.modules.some(n=>n.id==='api-keys'));
  const ids=new Set(scoped.modules.map(n=>n.id));
  for(const id of ['btc-source','eth-source','usdt-source','usdc-source','btc-normal','eth-normal','account-node'])assert.equal(ids.has(id),false);
  for(const n of scoped.modules){assert.deepEqual(n.assets,['BLCH']);assert.deepEqual(Object.keys(n.links_by_asset),['BLCH']);for(const link of n.links_by_asset.BLCH){const asset=new URL(link.href).searchParams.get('asset');assert.ok(asset===null||asset.toUpperCase()==='BLCH');}}
  assert.ok(scoped.connections.every(e=>ids.has(e.from)&&ids.has(e.to)));
  assert.equal(manifest.modules.length,44,'Shared Graphus fixture is unchanged');
});
test('source API requests are pinned to Bloch and preserve exact evidence',async()=>{
  for(const asset of ['BLCH']){let requested;
    const packet=await captureSystemPage(null,new AbortController().signal,async(url,init)=>{requested={url,init};return new Response(JSON.stringify(sample(asset)),{headers:{'content-type':'application/json'}});});
    assert.equal(requested.url,`https://bloch-graphus.xyz/api/chain/network?asset=${asset}`);assert.equal(requested.init.credentials,'omit');assert.equal(requested.init.redirect,'error');
    assert.equal(packet.dataset.asset,asset);assert.equal(packet.dataset.edges[0].amount_base_units,'9007199254740993123456789');assert.equal(packet.identity_attribution_included,false);
    const next=await evidencePacket(sample(asset,1),asset,{cursor:packet.pagination.next_cursor}),merged=await mergeEvidence(packet,next);assert.equal(merged.diagnostics.records,50);
    const filtered=await filteredEvidence(merged,{query:packet.dataset.edges[0].txid});assert.equal(filtered.selection.parent_dataset_sha256,merged.dataset_sha256);assert.deepEqual(await validateEvidenceCollection(filtered),filtered);
    const graph=sampleGraph(merged,merged.dataset.edges);assert.equal(graph.edges.length,50);assert.ok(graph.nodes.every(n=>n.kind===(n.id.includes(':transaction:')?'transaction':'script')));
  }
  await assert.rejects(()=>captureSystemPage(null,new AbortController().signal,async()=>new Response(JSON.stringify(sample('ETH')))));
});
test('capture failures do not fabricate samples and visual graph limits do not alter exports',async()=>{
  await assert.rejects(()=>captureSystemPage(null,new AbortController().signal,async()=>new Response('{}',{status:503})),/503/);
  const packet=await evidencePacket(sample('ETH'),'ETH'),rows=Array.from({length:1000},(_,i)=>({...packet.dataset.edges[0],event_id:'event-'+i}));
  const graph=sampleGraph(packet,rows);assert.equal(graph.edges.length,800);assert.equal(graph.omitted,200);assert.equal(rows.length,1000);assert.equal(packet.dataset.edges.length,25);
  const nodeLimitPacket=structuredClone(packet);nodeLimitPacket.dataset.nodes=Array.from({length:300},(_,i)=>({id:'node-'+i,kind:'address',address:'0x'+i.toString(16).padStart(40,'0')}));
  const many=Array.from({length:299},(_,i)=>({...rows[0],from:'node-'+i,to:'node-'+(i+1)}));const bounded=sampleGraph(nodeLimitPacket,many);assert.equal(bounded.nodes.length,220);assert.equal(bounded.edges.length+bounded.omitted,many.length);
  assert.equal(sourceLink('BLCH','a'.repeat(64),true,'b'.repeat(64)),`/tx/${'a'.repeat(64)}?block=${'b'.repeat(64)}`);
});
test('vendored evidence code matches its recorded source revision byte for byte',async()=>{
  const dir=new URL('../../src/vendor/graphus/',import.meta.url),provenance=JSON.parse(await readFile(new URL('provenance.json',dir),'utf8'));
  for(const [file,digest]of Object.entries(provenance.sha256)){const bytes=await readFile(new URL(file,dir));assert.equal(createHash('sha256').update(bytes).digest('hex'),digest,file);}
});
