import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleGateway, resetGatewayForTests } from '../../gateway/worker.js';
import { MAINNET_DOMAIN, MAINNET_GENESIS, validateNativeParams } from '../../gateway/native-wallet.js';
import { reset } from './harness.mjs';
const owner = 'ab'.repeat(3749), hash = 'ab'.repeat(32), endpoint = 'https://observer.example/rpc';
let now, calls, result;
const activation = () => ({ schema: 'postern.native-gateway-activation.v1', format:'BPOSMAN1', domain: MAINNET_DOMAIN, genesis: MAINNET_GENESIS, head: hash, stateRoot: hash, activationProfileSha256:hash, activationEpoch:'10', observedEpoch:'11', observedAt:now, expiresAt:now+300000 });
const env = () => ({ EXPLORER_ARCHIVALS:endpoint, NATIVE_WALLET_UPSTREAM:endpoint, NATIVE_WALLET_READS:'enabled', NATIVE_WALLET_ACTIVATION:JSON.stringify(activation()) });
const view = () => ({ format:'BPOSMAN1', domain:MAINNET_DOMAIN, genesis:MAINNET_GENESIS, head:hash, stateRoot:hash, height:'352', context:{epoch:'11',utxos:[],nativeSnapshotHex:'aa',nativeCommitmentHex:hash} });
beforeEach(()=>{reset();resetGatewayForTests(); now=1000000;calls=0;result=view();});
async function call(method='getnativewalletview', params=[{ownerPublicKeyHex:owner}], config=env(), fetchImpl) {
 const r = await handleGateway(new Request('https://posternlabs.com/g4rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:7,method,params})}),config,{}, {now:()=>now,fetchImpl:fetchImpl || (async (url, init)=> {calls++;assert.equal(url,endpoint);assert.equal(init.redirect,'manual');return Response.json({jsonrpc:'2.0',id:7,result});})});
 assert.equal(r.headers.get('cache-control'),'no-store');return r.json();
}
test('disabled, stale, future, lab and incomplete activation refuse without forwarding',async()=>{
 for(const mutate of [e=>delete e.NATIVE_WALLET_READS,e=>e.NATIVE_WALLET_READS='true',e=>e.NATIVE_WALLET_ACTIVATION='{}', e=>{const a=activation();a.expiresAt=now;e.NATIVE_WALLET_ACTIVATION=JSON.stringify(a);},e=>{const a=activation();a.format='BPOSLAB1';e.NATIVE_WALLET_ACTIVATION=JSON.stringify(a);},e=>{const a=activation();a.observedAt=now+1;e.NATIVE_WALLET_ACTIVATION=JSON.stringify(a);}]){const e=env();mutate(e);assert.ok((await call(undefined,undefined,e)).error);}
 assert.equal(calls,0);
});
test('only owner scoped requests and exact quote shapes pass',async()=>{
 for(const params of [[],[{}],[{ownerPublicKeyHex:owner,all:true}],[{ownerPublicKeyHex:'ab'}]]) assert.equal((await call(undefined,params)).error.code,-32602);
 assert.equal(calls,0);
 const q={operation:'swap',ownerPublicKeyHex:owner,expectedHead:hash,validUntil:'400',pool:hash,inputAsset:hash,amount:'1',minimumOut:'0'};
 assert.ok(validateNativeParams('getnativepoolquote',[q]));
 for(const patch of [{amount:'01'},{amount:'18446744073709551616'},{rpc:'https://evil'},{operation:'withdraw'}])assert.equal(validateNativeParams('getnativepoolquote',[{...q,...patch}]),false);
 assert.ok((await call('getnativelabstate',[hash,hash])).error);assert.equal(calls,0);
});
test('successful view is single observer uncached and never claims finality',async()=>{
 const v=await call();assert.equal(calls,1);assert.equal(v.result.finalityVerified,false);assert.equal(v.corroboration.level,'uncorroborated');
});
test('lab, wrong domain, inactive and oversized context replies fail closed',async()=>{
 for(const patch of [{format:'BPOSLAB1'},{domain:'00'.repeat(32)},{context:{...view().context,epoch:'9'}},{context:{...view().context,utxos:Array(129).fill({})}},{context:null}]){resetGatewayForTests();result={...view(),...patch};assert.ok((await call()).error);}
});
test('upstream errors and timeouts never fan out or retry',async()=>{
 const v=await call(undefined,undefined,env(),async()=>{calls++;throw Error('timeout');});assert.ok(v.error);assert.equal(calls,1);
});
test('configured observer membership, result envelope and live expiry are enforced',async()=>{
 const e=env();e.NATIVE_WALLET_UPSTREAM='https://evil';assert.ok((await call(undefined,undefined,e)).error);assert.equal(calls,0);
 assert.ok((await call(undefined,undefined,env(),async()=>Response.json({jsonrpc:'2.0',id:99,result:view()}))).error);
 resetGatewayForTests();const config=env();assert.ok((await call(undefined,undefined,config,async()=>{now+=300001;return Response.json({jsonrpc:'2.0',id:7,result:view()});})).error);
});
test('quote binds expected head and bounded packet',async()=>{
 const q={operation:'swap',ownerPublicKeyHex:owner,expectedHead:hash,validUntil:'400',pool:hash,inputAsset:hash,amount:'1',minimumOut:'0'};
 result={...view(),transactionHex:'aa'};assert.ok((await call('getnativepoolquote',[q])).result);
 result.head='cc'.repeat(32);assert.ok((await call('getnativepoolquote',[q])).error);
});
test('one in-flight native request and bounded isolate budget protect observer',async()=>{
 let release;const blocked=new Promise(resolve=>{release=resolve;});
 const first=call(undefined,undefined,env(),async()=>{calls++;await blocked;return Response.json({jsonrpc:'2.0',id:7,result:view()});});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await call()).error.data.reason,'native_read_capacity');assert.equal(calls,1);
 release();assert.ok((await first).result);
 assert.ok((await call()).result);assert.equal((await call()).error.data.reason,'native_read_capacity');
});
test('oversized response is refused and no redirect or second observer is tried',async()=>{
 assert.ok((await call(undefined,undefined,env(),async()=>{calls++;return new Response('a'.repeat(2*1024*1024+1));})).error);assert.equal(calls,1);
});

test('real node Json::sat epoch is decimal string and native hybrid key is exactly 3749 bytes',async()=>{
 const publicKey = 'ab'.repeat(3749);
 assert.equal(publicKey.length,7498);
 assert.ok(validateNativeParams('getnativewalletview',[{ownerPublicKeyHex:publicKey}]));
 for(const bytes of [3748,3750]) assert.equal(validateNativeParams('getnativewalletview',[{ownerPublicKeyHex:'ab'.repeat(bytes)}]),false);
 // engine.rs emits context.epoch and height through Json::sat, which serializes strings.
 result={...view(),height:'352',context:{...view().context,epoch:'11'}};
 assert.ok((await call()).result);
 resetGatewayForTests();result.context.epoch=11;
 assert.ok((await call()).error);
});
test('negative activation timestamps are invalid even if arithmetic would otherwise be fresh',async()=>{
 now=0;
 for(const patch of [{observedAt:-1,expiresAt:1000},{observedAt:-1000,expiresAt:-1}]){
  const e=env();e.NATIVE_WALLET_ACTIVATION=JSON.stringify({...activation(),...patch});
  assert.ok((await call(undefined,undefined,e)).error);
 }
 assert.equal(calls,0);
});
