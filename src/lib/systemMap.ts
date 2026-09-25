// SPDX-License-Identifier: AGPL-3.0-or-later
import {fetchEvidence, type Asset, type EvidencePacket, type EvidenceRecord} from '../vendor/graphus/system_evidence.js';
import type {EvidenceGraph} from './intelligence.ts';
export type {Asset, EvidencePacket, EvidenceRecord};
export const GRAPHUS = 'https://bloch-graphus.xyz';
export const ASSETS: Asset[] = ['BTC','ETH','USDT','USDC','BLCH'];
export const EXPLORER_ASSET = 'BLCH' as const;
export interface ModuleLink {action: string; label: string; href: string}
export interface SystemModule {id: string; title: string; layer: string; category: string; assets: Asset[]; status: string; access: string; description: string; inputs: string[]; outputs: string[]; limits: string; actions: string[]; links_by_asset: Partial<Record<Asset, ModuleLink[]>>}
export interface ModuleConnection {from: string; to: string; contract: string}
export interface SystemManifest {schema_version: 1; registry_version: string; assets: Asset[]; layers: string[]; statuses: Record<string,string>; categories: Record<string,string>; modules: SystemModule[]; connections: ModuleConnection[]}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max=1200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const strings = (v: unknown, max=30): v is string[] => Array.isArray(v) && v.length <= max && v.every(s=>text(s));
const allowedOrigins = new Set([GRAPHUS,'https://bloch.space','https://rednblue.space','https://aml-blochinc.xyz']);
export function safeModuleLink(value: unknown): value is string {
  if(!text(value,500))return false;
  try{const url=new URL(value);return !url.username&&!url.password&&allowedOrigins.has(url.origin);}catch{return false;}
}
export function parseSystemManifest(value: unknown): SystemManifest {
  const fail=()=>{throw new Error('The System Map API returned an unsupported registry.');};
  if(!object(value)||value.schema_version!==1||!text(value.registry_version,80)||!strings(value.assets,5)||new Set(value.assets).size!==5||!ASSETS.every(a=>value.assets.includes(a))||!strings(value.layers,10)||new Set(value.layers).size!==value.layers.length||!value.layers.length||!object(value.statuses)||!object(value.categories)||!Array.isArray(value.modules)||!value.modules.length||value.modules.length>100||!Array.isArray(value.connections)||value.connections.length>500)return fail();
  for(const names of [value.statuses,value.categories])if(Object.keys(names).length>30||Object.values(names).some(v=>!text(v,80)))return fail();
  const ids=new Set<string>();
  const modules: SystemModule[]=value.modules.map((n:any)=>{
    if(!object(n)||!text(n.id,80)||!/^[-a-z0-9]+$/.test(n.id)||ids.has(n.id)||!text(n.title,100)||!value.layers.includes(n.layer)||!Object.prototype.hasOwnProperty.call(value.statuses,n.status)||!Object.prototype.hasOwnProperty.call(value.categories,n.category)||!['public','private','research'].includes(n.access)||!strings(n.assets,5)||!n.assets.length||n.assets.some(a=>!ASSETS.includes(a as Asset))||!strings(n.inputs)||!strings(n.outputs)||!strings(n.actions)||!text(n.description)||!text(n.limits)||!object(n.links_by_asset))return fail();
    const links: SystemModule['links_by_asset']={};
    for(const asset of n.assets as Asset[]){const rows=n.links_by_asset[asset];if(!Array.isArray(rows)||rows.length>20)return fail();links[asset]=rows.map(link=>{if(!object(link)||!text(link.action,80)||!n.actions.includes(link.action)||!text(link.label,100)||!safeModuleLink(link.href))return fail();return {action:link.action,label:link.label,href:link.href};});}
    ids.add(n.id);return {id:n.id,title:n.title,layer:n.layer,category:n.category,assets:n.assets as Asset[],status:n.status,access:n.access,description:n.description,inputs:n.inputs,outputs:n.outputs,limits:n.limits,actions:n.actions,links_by_asset:links};
  });
  const pairs=new Set<string>();const connections: ModuleConnection[]=value.connections.map((e:any)=>{if(!object(e)||!ids.has(e.from)||!ids.has(e.to)||!text(e.contract)||pairs.has(e.from+':'+e.to))return fail();pairs.add(e.from+':'+e.to);return {from:e.from,to:e.to,contract:e.contract};});
  return {schema_version:1,registry_version:value.registry_version,assets:[...ASSETS],layers:[...value.layers],statuses:{...value.statuses},categories:{...value.categories},modules,connections};
}
export async function loadSystemManifest(signal: AbortSignal, fetcher=fetch): Promise<SystemManifest> {
  const response=await fetcher(GRAPHUS+'/api/system/map',{signal,credentials:'omit',redirect:'error',headers:{accept:'application/json'}});
  if(!response.ok)throw new Error(`System Map catalog unavailable (HTTP ${response.status}).`);
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty System Map response.');
  let size=0,raw='';const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>250000)throw new Error('System Map catalog exceeds its limit.');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
  return blochSystemManifest(parseSystemManifest(JSON.parse(raw)));
}
/** Project the shared catalog before any map, inspector or dependency navigation. */
export function blochSystemManifest(manifest: SystemManifest): SystemManifest {
  const modules=manifest.modules.filter(n=>n.assets.includes(EXPLORER_ASSET)).map(n=>({
    ...n,assets:[EXPLORER_ASSET],links_by_asset:{BLCH:n.links_by_asset.BLCH},
    ...(n.id==='asset-registry'?{title:'Bloch asset identity',description:'Interpret Bloch mainnet records using the native BLCH asset and exact base units.',inputs:['Bloch mainnet','Native BLCH asset'],limits:'Amounts retain the source base-unit definition; script references do not identify holders.'}:{}),
  }));
  const ids=new Set(modules.map(n=>n.id));
  return {...manifest,assets:[EXPLORER_ASSET],modules,connections:manifest.connections.filter(e=>ids.has(e.from)&&ids.has(e.to)),layers:manifest.layers.filter(layer=>modules.some(n=>n.layer===layer))};
}
export function captureSystemPage(cursor: string | null, signal: AbortSignal, fetcher=fetch) {
  return fetchEvidence(EXPLORER_ASSET,{cursor,signal,fetcher:((path,init)=>fetcher(GRAPHUS+String(path),{...init,credentials:'omit',mode:'cors',redirect:'error'})) as typeof fetch});
}
export function sourceLink(asset: Asset, reference: string, transaction=false, blockHash?: string): string {
  if(asset==='BLCH')return transaction?`/tx/${encodeURIComponent(reference)}${blockHash?'?block='+encodeURIComponent(blockHash):''}`:`/graphus/constellation?script=${encodeURIComponent(reference)}`;
  const origin=asset==='BTC'?'https://blockstream.info':'https://etherscan.io';return `${origin}/${transaction?'tx':'address'}/${encodeURIComponent(reference)}`;
}
export function sampleGraph(packet: EvidencePacket, rows: EvidenceRecord[]): EvidenceGraph {
  const nodes=new Map(packet.dataset.nodes.map(n=>[n.id,n])),used=new Set<string>(),edges: EvidenceGraph['edges']=[],degree=new Map<string,number>();let omitted=0;
  for(const record of rows){const fresh=[record.from,record.to].filter((id,i,all)=>!used.has(id)&&all.indexOf(id)===i);if(edges.length>=800||used.size+fresh.length>220){omitted++;continue;}used.add(record.from);used.add(record.to);edges.push({source:record.from,target:record.to,kind:record.kind});for(const id of [record.from,record.to])degree.set(id,(degree.get(id)||0)+1);}
  return {nodes:[...used].map(id=>{const node=nodes.get(id)!;const ref=node.address||node.txid!;return {id,label:ref.slice(0,10)+'…'+ref.slice(-6),kind:node.kind==='transaction'?'transaction':node.kind==='address'?'address':'script',detail:`${node.kind} · ${ref} · ${degree.get(id)} incident displayed records`,href:sourceLink(packet.dataset.asset,ref,node.kind==='transaction'),weight:degree.get(id)||1};}),edges,omitted};
}
