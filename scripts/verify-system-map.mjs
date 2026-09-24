import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {sample} from '../edge/tests/fixtures/system-map-sample.mjs';
import {validateEvidenceCollection} from '../src/vendor/graphus/system_evidence.js';
const {webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),live=process.env.EXPLORER_ORIGIN;
if(live)assert.equal(live,'https://blochl1.com');
const assets=(process.env.SYSTEM_MAP_ASSETS||'BTC,ETH,BLCH,USDT,USDC').split(',');assert.ok(assets.every(a=>['BTC','ETH','BLCH','USDT','USDC'].includes(a)));
let server;const fixture=JSON.parse(await readFile(new URL('../edge/tests/fixtures/system-map.json',import.meta.url),'utf8'));
if(!live){const root=resolve('dist');server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(/^\/(rpc|g4|indexer|research)(\/|$)/.test(url.pathname)){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"test-only no chain head"}');return;}let path=resolve(root,'.'+url.pathname);if(!path.startsWith(root+'/'))throw new Error('Invalid path');if(!extname(path))path=resolve(root,'index.html');res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end('Not found');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));}
const origin=live||`http://127.0.0.1:${server.address().port}`,browser=await webkit.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],reads=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('https://bloch-graphus.xyz/api/chain/network'))reads.push(r);});
const apiHeaders={'access-control-allow-origin':'*','content-type':'application/json'};
const bodyFor=url=>{const q=new URL(url).searchParams,asset=q.get('asset'),cursor=q.get('cursor');return sample(asset,cursor===null?0:asset==='BLCH'?Number(cursor.split('-').at(-1)):100-Number(cursor));};
const action=name=>page.getByRole('button',{name,exact:true});
const idle=()=>page.waitForFunction(()=>!document.querySelector('#sm-start').disabled,null,{timeout:75000});
async function exported(name){const waiting=page.waitForEvent('download');await action(name).click();return JSON.parse(await readFile(await(await waiting).path(),'utf8'));}
async function closeDetails(){if(await page.locator('.sm-details-dialog').evaluate(e=>e.open)){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.sm-details-dialog').open);}else if(await page.locator('.sm-inspector').count())await page.locator('.sm-inspector').getByRole('button',{name:'Close ×',exact:true}).click();}
async function selectModule(id){await action('Directory').click();await page.locator(`.sm-directory [data-module="${id}"]`).click();}
async function fit(){await action('Fit map').click();await page.waitForFunction(()=>{const chart=document.querySelector('.sm-diagram svg'),r=chart.getBoundingClientRect();return [...chart.querySelectorAll('[data-module]')].every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1&&b.top>=r.top-1&&b.bottom<=r.bottom+1;});});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,JSON.stringify(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,scrollX,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right+scrollX>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right}))}))));}
try{
  if(!live){await page.route('https://bloch-graphus.xyz/api/system/map',r=>r.fulfill({headers:apiHeaders,json:fixture}));await page.route('https://bloch-graphus.xyz/api/chain/network?*',r=>r.fulfill({headers:apiHeaders,json:bodyFor(r.request().url())}));}
  await mkdir('/private/tmp/bloch-system-map',{recursive:true});
  for(const width of [1440,1280,1024,390]){
    await page.setViewportSize({width,height:1000});await page.goto(origin+'/system-map');await page.waitForSelector('.sm-panel');await action('Map').click();assert.equal(await page.locator('.sm-diagram [data-module]').count(),44);await fit();
    await page.locator('.sm-diagram [data-module=catalog] rect').click();assert.equal(await page.locator('.sm-inspector-content:visible h2').innerText(),'Field catalog');await closeDetails();
    await action('Expand workspace').click();assert.equal(await page.locator('.sm-expanded').evaluate(e=>e.open),true);await fit();await page.screenshot({path:`/private/tmp/bloch-system-map/${live?'live':'local'}-${width}.png`});await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.sm-expanded').open);
    await page.getByLabel('Find a module',{exact:true}).fill('Integration API keys');assert.equal(await page.locator('.sm-diagram [data-module]').count(),1);await page.locator('.sm-diagram [data-module=api-keys] rect').click();assert.equal(await page.locator('.sm-inspector-content:visible a[href="https://rednblue.space/portal/?view=access"]').count(),1);await closeDetails();
    await page.getByLabel('Find a module',{exact:true}).fill('no matching module');assert.equal(await page.locator('.sm-diagram [data-module]').count(),0);await action('Reset filters').click();console.log(JSON.stringify({viewport:width,map_modules:44,horizontal_overflow:false,dialogs:true}));
  }
  assert.equal(reads.length,0,'Map navigation never triggers a source capture');await page.setViewportSize({width:1440,height:1000});
  let last;
  for(const asset of assets){
    await page.getByLabel('Capture asset',{exact:true}).selectOption(asset);await page.getByLabel('Module asset',{exact:true}).selectOption(asset);await selectModule('events');await action(`Capture ${asset} evidence`).click();await idle();
    if(live&&!await page.locator('.sm-provenance').count()){await action('Capture latest').click();await idle();}
    assert.equal(await page.locator('.sm-provenance').count(),1,await page.locator('#sm-capture-status').innerText());last=await exported('Export full collection JSON');assert.equal(last.dataset.asset,asset);await validateEvidenceCollection(last);
    const before=reads.length;await selectModule('events');assert.ok((await page.locator('.sm-capture-context').innerText()).includes(asset));await action('Inspect captured graph and records').click();
    if(last.dataset.edges.length){const edge=last.dataset.edges[0];await page.getByLabel('Address, script or transaction',{exact:true}).fill(edge.txid);const filtered=await exported('Export filtered JSON');assert.equal(filtered.selection.parent_dataset_sha256,last.dataset_sha256);assert.ok(filtered.dataset.edges.every(e=>e.txid===edge.txid));await validateEvidenceCollection(filtered);await page.locator('.sm-sample-graph [data-node]').first().focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.sm-sample-graph .atlas-graph-inspector a').count(),1);await action('Reset record filters').click();}
    assert.equal(reads.length,before,'Graph inspection, filtering and export reuse the same sample');
    assert.ok(reads.every(r=>r.url().startsWith('https://bloch-graphus.xyz/api/chain/network?')));
    console.log(JSON.stringify({mode:live?'production':'fixture',asset,records:last.diagnostics.records,references:last.diagnostics.references,digest:last.dataset_sha256,source_reads:reads.length-before}));
  }
  await page.getByRole('button',{name:'Switch to the light theme',exact:true}).click();await page.locator('.sm-sample-graph').screenshot({path:`/private/tmp/bloch-system-map/${live?'live':'local'}-evidence-light.png`});await page.getByRole('button',{name:'Switch to the dark theme',exact:true}).click();
  await page.setViewportSize({width:390,height:900});await selectModule('events');await page.screenshot({path:`/private/tmp/bloch-system-map/${live?'live':'local'}-details-mobile.png`});await closeDetails();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.setViewportSize({width:1440,height:1000});
  if(!live){
    await page.getByLabel('Capture asset',{exact:true}).selectOption('ETH');await action('Capture latest').click();await idle();const baseline=await exported('Export full collection JSON');await action('Pin baseline').click();await action('Load earlier pages').click();await idle();const extended=await exported('Export full collection JSON');assert.equal(extended.diagnostics.records,50);const comparison=await exported('Export comparison JSON');assert.equal(comparison.baseline_sha256,baseline.dataset_sha256);assert.equal(comparison.counts.shared,25);assert.equal(comparison.counts.only_current,25);
    await page.getByLabel('Minimum base units',{exact:true}).fill('1e30');assert.equal(await action('Export filtered JSON').isDisabled(),true);await action('Reset record filters').click();
    await page.unroute('https://bloch-graphus.xyz/api/chain/network?*');await page.route('https://bloch-graphus.xyz/api/chain/network?*',r=>r.fulfill({status:503,headers:apiHeaders,json:{error:'test-only source failure'}}));await action('Load earlier pages').click();await idle();assert.match(await page.locator('#sm-capture-status').innerText(),/503.*2 completed/);assert.equal((await exported('Export full collection JSON')).dataset_sha256,extended.dataset_sha256);
    await page.unroute('https://bloch-graphus.xyz/api/chain/network?*');await page.route('https://bloch-graphus.xyz/api/chain/network?*',async r=>{await new Promise(resolve=>setTimeout(resolve,800));await r.fulfill({headers:apiHeaders,json:bodyFor(r.request().url())}).catch(()=>{});});
    const pending=page.waitForRequest(r=>r.url().includes('/api/chain/network?'));await action('Load earlier pages').click();await pending;await action('Cancel capture').click();await page.waitForTimeout(900);assert.equal((await exported('Export full collection JSON')).dataset_sha256,extended.dataset_sha256);
    const next=page.waitForRequest(r=>r.url().includes('/api/chain/network?'));await action('Capture latest').click();await next;await page.getByLabel('Capture asset',{exact:true}).selectOption('BLCH');await page.waitForTimeout(900);assert.equal(await page.locator('.sm-provenance').count(),0);
    await page.unroute('https://bloch-graphus.xyz/api/system/map');await page.route('https://bloch-graphus.xyz/api/system/map',r=>r.fulfill({status:503,headers:apiHeaders,json:{error:'test-only catalog failure'}}));await page.goto(origin+'/system-map');await page.waitForSelector('.sm-error');assert.equal(await page.locator('.sm-node').count(),0);
    await page.unroute('https://bloch-graphus.xyz/api/system/map');await page.route('https://bloch-graphus.xyz/api/system/map',r=>r.fulfill({headers:apiHeaders,json:fixture}));await action('Retry catalog').click();await page.waitForSelector('.sm-panel');
  }
  assert.deepEqual(errors,[]);console.log('Explorer System Map passed: API registry, complete map fit, actual clicks, native dialogs, five-asset capture contracts, exact exports, reference search, graph inspection, mobile and themes.'+(live?'':' Local fixtures also verified baseline comparison, failed continuation, cancellation, asset changes and catalog retry.'));
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
