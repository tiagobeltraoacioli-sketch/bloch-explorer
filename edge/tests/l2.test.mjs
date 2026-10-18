// SPDX-License-Identifier: AGPL-3.0-or-later
// The /l2 explorer: the /l2rpc policy (edge/l2rpc.js) and the pure decoding
// in src/lib/l2.ts. A live check against a real L2 RPC runs when
// L2_LIVE_URL is set (see scripts/l2-explorer-snapshot.mjs for the pages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCall, handleL2Rpc, describeL2Rpc, upstreams, MAX_BATCH, MAX_LOG_SPAN } from '../l2rpc.js';
import { onRequestPost, onRequestGet } from '../../functions/l2rpc.js';
import {
  fmtUnits, fmtNative, decodeTransfer, decodeAbiString, levelOf, parseFinality, parseSettlement,
  classifyQuery, addrTopic, methodOf, txFee, txStatus, TRANSFER_TOPIC, l2Batch, L2RpcError, predeployLabel,
} from '../../src/lib/l2.ts';

const A = '0x72dc623d4c03c996a3d20ed2674f24570e8acf44';
const H = '0x' + 'ab'.repeat(32);
const call = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const req = (body) => new Request('https://blochl1.com/l2rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

function upstream(chainHex = '0xab162', answer = (c) => ({ result: `ok:${c.method}` })) {
  const seen = [];
  const f = async (url, init) => {
    const batch = JSON.parse(init.body);
    seen.push({ url, batch });
    return new Response(JSON.stringify(batch.map((c) => c.method === 'eth_chainId' ? { jsonrpc: '2.0', id: c.id, result: chainHex } : { jsonrpc: '2.0', id: c.id, ...answer(c) })), { status: 200 });
  };
  f.seen = seen;
  return f;
}
const ENV = { L2_RPC_URL: 'https://l2rpc.example/' };

// ─── policy ─────────────────────────────────────────────────────────────────

test('read methods pass, writes and unknown methods are refused', () => {
  for (const [m, p] of [
    ['eth_chainId', []], ['eth_blockNumber', []], ['bloch_finality', []],
    ['eth_getBlockByNumber', ['finalized', true]], ['eth_getBlockByNumber', ['0x2ac', false]],
    ['eth_getBlockByHash', [H, false]], ['eth_getTransactionByHash', [H]], ['eth_getTransactionReceipt', [H]],
    ['eth_getBlockReceipts', ['0x10']], ['eth_getBlockReceipts', [H]],
    ['eth_getBalance', [A, 'latest']], ['eth_getBalance', [A, 'safe']], ['eth_getTransactionCount', [A, 'latest']],
    ['eth_getCode', [A, 'latest']], ['bloch_settlement', ['0x5']],
  ]) assert.ok(checkCall(call(m, p)).call, `${m} ${JSON.stringify(p)}`);
  for (const m of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_newFilter', 'eth_subscribe', 'debug_traceTransaction', 'admin_peers', 'eth_estimateGas', 'toString', '__proto__']) {
    assert.equal(checkCall(call(m, [])).error.error.code, -32601, m);
  }
});

test('malformed params are refused with -32602', () => {
  for (const [m, p] of [
    ['eth_getBlockByNumber', ['1', true]], ['eth_getBlockByNumber', ['0x0001', true]], ['eth_getBlockByNumber', [{}, true]],
    ['eth_getTransactionByHash', ['0x12']], ['eth_getBalance', ['0x12', 'latest']], ['eth_getBalance', [A, 'latest', 'x']],
    ['eth_getBlockByNumber', ['0x' + 'f'.repeat(17), false]],
  ]) assert.equal(checkCall(call(m, p)).error.error.code, -32602, `${m} ${JSON.stringify(p)}`);
});

test('eth_call is limited to ERC-20 views', () => {
  const ok = (data) => checkCall(call('eth_call', [{ to: A, data }, 'latest'])).call;
  assert.ok(ok('0x06fdde03') && ok('0x95d89b41') && ok('0x313ce567') && ok('0x18160ddd'));
  assert.ok(ok('0x70a08231' + '0'.repeat(24) + A.slice(2)));
  assert.ok(!ok('0xa9059cbb' + '0'.repeat(128)), 'transfer');
  assert.ok(!ok('0x70a08231' + 'f'.repeat(64)), 'balanceOf with a dirty address word');
  assert.ok(!ok('0x06fdde0300'), 'trailing bytes');
  assert.ok(!checkCall(call('eth_call', [{ to: A, data: '0x06fdde03', from: A, gas: '0xffffffff' }, 'latest'])).call, 'extra call fields');
  assert.ok(!checkCall(call('eth_call', [{ data: '0x06fdde03' }, 'latest'])).call, 'no target');
});

test('eth_getLogs needs a filter and a bounded numeric range', () => {
  const t = [TRANSFER_TOPIC, addrTopic(A)];
  assert.ok(checkCall(call('eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest', topics: t }])).call);
  assert.ok(checkCall(call('eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest', address: A }])).call);
  assert.ok(checkCall(call('eth_getLogs', [{ blockHash: H, address: A }])).call);
  assert.equal(checkCall(call('eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest' }])).error.error.code, -32602);
  assert.equal(checkCall(call('eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest', topics: [null] }])).error.error.code, -32602);
  assert.equal(checkCall(call('eth_getLogs', [{ fromBlock: '0x0', toBlock: '0x' + MAX_LOG_SPAN.toString(16), address: A }])).error.error.code, -32602);
  assert.ok(checkCall(call('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x' + MAX_LOG_SPAN.toString(16), address: A }])).call);
  assert.equal(checkCall(call('eth_getLogs', [{ fromBlock: '0x5', toBlock: '0x4', address: A }])).error.error.code, -32602);
  assert.equal(checkCall(call('eth_getLogs', [{ address: A, limit: 5 }])).error.error.code, -32602);
});

test('forwarding: one batch upstream with a chain-id probe, answers in caller order', async () => {
  const f = upstream();
  const res = await handleL2Rpc(req([call('eth_blockNumber', [], 7), call('eth_sendRawTransaction', ['0x00'], 8), call('eth_getBalance', [A, 'latest'], 'x')]), ENV, f);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.map((o) => o.id), [7, 8, 'x']);
  assert.equal(out[0].result, 'ok:eth_blockNumber');
  assert.equal(out[1].error.code, -32601);
  assert.equal(out[2].result, 'ok:eth_getBalance');
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0].batch[0].method, 'eth_chainId');
  assert.ok(!f.seen[0].batch.some((c) => c.method === 'eth_sendRawTransaction'));
});

test('a single (non-batch) call gets a single answer; upstream errors pass through', async () => {
  const f = upstream('0xab162', () => ({ error: { code: -32000, message: 'header not found' } }));
  const res = await handleL2Rpc(req(call('eth_getBlockByNumber', ['0x99999', false], 3)), ENV, f);
  const out = await res.json();
  assert.equal(out.id, 3);
  assert.equal(out.error.message, 'header not found');
});

test('chain-id guard: a devnet upstream behind a mainnet explorer is refused', async () => {
  const res = await handleL2Rpc(req([call('eth_blockNumber', [])]), ENV, upstream('0xab163'));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error.message, /chain 700771, expected 700770/);
  const dev = await handleL2Rpc(req([call('eth_blockNumber', [])]), { ...ENV, L2_CHAIN_ID: '700771' }, upstream('0xab163'));
  assert.equal(dev.status, 200);
});

test('fallback upstreams, unconfigured upstream, limits', async () => {
  let n = 0;
  const flaky = async (url, init) => { n++; if (url.includes('down')) throw new Error('down'); return upstream()(url, init); };
  const res = await handleL2Rpc(req([call('eth_chainId', [])]), { L2_RPC_URL: 'https://down.example/ https://up.example/' }, flaky);
  assert.equal(res.status, 200);
  assert.equal(n, 2);
  assert.equal((await handleL2Rpc(req([call('eth_chainId', [])]), {}, upstream())).status, 503);
  assert.deepEqual(upstreams({ L2_RPC_URL: 'ftp://x/ https://ok/ nonsense' }), ['https://ok/']);
  const big = Array.from({ length: MAX_BATCH + 1 }, (_, i) => call('eth_chainId', [], i));
  assert.equal((await handleL2Rpc(req(big), ENV, upstream())).status, 400);
  assert.equal((await handleL2Rpc(req('{nope'), ENV, upstream())).status, 400);
  assert.equal((await handleL2Rpc(req([call('eth_chainId', [], 1), call('eth_blockNumber', [], 1)]), ENV, upstream())).status, 400, 'duplicate ids');
  assert.equal((await handleL2Rpc(req('x'.repeat(70 * 1024)), ENV, upstream())).status, 413);
  const down = await handleL2Rpc(req([call('eth_chainId', [])]), ENV, async () => new Response('bad gateway', { status: 502 }));
  assert.equal(down.status, 502);
});

test('the Pages Function wires POST and GET', async () => {
  const get = await onRequestGet({ env: ENV });
  const d = await get.json();
  assert.equal(d.chainId, 700770);
  assert.deepEqual(d.upstreamHosts, ['l2rpc.example']);
  assert.ok(d.methods.includes('eth_getLogs') && !d.methods.includes('eth_sendRawTransaction'));
  const unconfigured = await onRequestPost({ request: req([call('eth_chainId', [])]), env: {} });
  assert.equal(unconfigured.status, 503);
  assert.equal((await describeL2Rpc({})).status, 200);
});

// ─── decoding ───────────────────────────────────────────────────────────────

test('fmtUnits is integer-exact', () => {
  assert.equal(fmtUnits(1500000000000000000n, 18), '1.5');
  assert.equal(fmtUnits(5000000000000000000n, 18), '5');
  assert.equal(fmtUnits(1234567891234567891234n, 18, 18), '1,234.567891234567891234');
  assert.equal(fmtUnits(1n, 18), '<0.000001');
  assert.equal(fmtUnits(0n, 18), '0');
  assert.equal(fmtUnits(123n, 0), '123');
  assert.equal(fmtNative(10n ** 18n), '1 BLCH');
});

test('Transfer logs: ERC-20, ERC-721, and look-alikes', () => {
  const base = { address: '0xDE215B8672FB89692C89B9F5B75D09D4F6E3C2BE', blockNumber: '0x10', transactionHash: H, logIndex: '0x2' };
  const e20 = decodeTransfer({ ...base, topics: [TRANSFER_TOPIC, addrTopic(A), addrTopic('0x' + '11'.repeat(20))], data: '0x' + (10n ** 18n).toString(16).padStart(64, '0') });
  assert.equal(e20.standard, 'ERC-20');
  assert.equal(e20.from, A);
  assert.equal(e20.to, '0x' + '11'.repeat(20));
  assert.equal(e20.value, 10n ** 18n);
  assert.equal(e20.token, base.address.toLowerCase());
  assert.equal(e20.block, 16);
  const e721 = decodeTransfer({ ...base, topics: [TRANSFER_TOPIC, addrTopic(A), addrTopic(A), '0x' + '0'.repeat(63) + '7'], data: '0x' });
  assert.equal(e721.standard, 'ERC-721');
  assert.equal(e721.value, 7n);
  assert.equal(decodeTransfer({ ...base, topics: [TRANSFER_TOPIC, addrTopic(A)], data: '0x' }), null);
  assert.equal(decodeTransfer({ ...base, topics: ['0x' + '0'.repeat(64), addrTopic(A), addrTopic(A)], data: '0x' + '0'.repeat(64) }), null);
});

test('ABI strings: dynamic, bytes32, hostile', () => {
  const dyn = (s) => { const hex = Buffer.from(s).toString('hex'); return '0x' + (32).toString(16).padStart(64, '0') + Buffer.byteLength(s).toString(16).padStart(64, '0') + hex.padEnd(Math.ceil(hex.length / 64) * 64 || 64, '0'); };
  assert.equal(decodeAbiString(dyn('Wrapped BLCH')), 'Wrapped BLCH');
  assert.equal(decodeAbiString('0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0')), 'MKR');
  assert.equal(decodeAbiString(dyn('a‮b\u0000c')), 'abc');
  assert.equal(decodeAbiString('0x'), null);
  assert.equal(decodeAbiString(dyn('x'.repeat(100))).length, 64);
});

test('finality levels are never promoted', () => {
  const f = parseFinality({ latest: { number: '0x2ad' }, safe: { number: '0x2ac' }, finalized: { number: '0x2aa' }, l1: { finalized: { epoch: 8154, slot: 260927, root: 'bad1' }, safe_settlement: { l2_number: 684, commitment: '3ea9' } }, trust: 't' });
  assert.equal(f.latest, 685);
  assert.equal(f.l1FinalizedSlot, 260927);
  assert.equal(f.safeL2Number, 684);
  assert.equal(levelOf(682, f), 'finalized');
  assert.equal(levelOf(683, f), 'safe');
  assert.equal(levelOf(684, f), 'safe');
  assert.equal(levelOf(685, f), 'latest');
  assert.equal(levelOf(686, f), 'unknown');
  assert.equal(levelOf(1, null), 'unknown');
  const none = parseFinality({ latest: { number: '0x5' }, safe: null, finalized: null }, 5);
  assert.equal(levelOf(1, none), 'latest');
});

test('settlement entries from bloch_settlement', () => {
  const s = parseSettlement({ l2_number: 684, l2_hash: '6c18'.repeat(16), commitment: '3ea9'.repeat(16), native_slot: 260831, native_block: 'a352'.repeat(16) });
  assert.equal(s.l1Slot, 260831);
  assert.equal(s.l1Block, 'a352'.repeat(16));
  assert.equal(parseSettlement(null), null);
  assert.equal(parseSettlement({ native_slot: 1 }), null);
});

test('search input classification and labels', () => {
  assert.deepEqual(classifyQuery(' 684 '), { kind: 'block', number: 684 });
  assert.deepEqual(classifyQuery(H.toUpperCase().replace('0X', '0x')), { kind: 'hash', hash: H });
  assert.deepEqual(classifyQuery(H.slice(2)), { kind: 'hash', hash: H });
  assert.deepEqual(classifyQuery(A.toUpperCase().replace('0X', '0x')), { kind: 'address', address: A });
  assert.equal(classifyQuery('blch1xyz').kind, 'none');
  assert.equal(methodOf('0x'), 'Transfer');
  assert.equal(methodOf('0xa9059cbb' + '0'.repeat(128)), 'transfer(address,uint256)');
  assert.equal(methodOf('0x12345678'), '0x12345678');
  assert.equal(txFee({ gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00' }), 21000n * 10n ** 9n);
  assert.equal(txStatus({ status: '0x1' }), 'success');
  assert.equal(txStatus({ status: '0x0' }), 'failed');
  assert.equal(txStatus(null), 'pending');
  assert.equal(predeployLabel('0x4200000000000000000000000000000000000102'), 'L2-to-L1 message passer (withdrawals)');
});

test('client batch: per-call errors are values, transport errors throw', async () => {
  const f = async (_u, init) => {
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify([{ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no' } }, { jsonrpc: '2.0', id: 0, result: '0x1' }]));
  };
  const [a, b] = await l2Batch([{ method: 'eth_blockNumber' }, { method: 'bloch_settlement', params: ['0x1'] }], f);
  assert.equal(a, '0x1');
  assert.ok(b instanceof L2RpcError && b.code === -32601);
  await assert.rejects(l2Batch([{ method: 'eth_blockNumber' }], async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'unreachable' } }), { status: 502 })), /unreachable/);
});

// ─── live (optional) ────────────────────────────────────────────────────────

const LIVE = process.env.L2_LIVE_URL;
test('live: the policy forwards real devnet/mainnet reads', { skip: !LIVE && 'set L2_LIVE_URL (and L2_LIVE_CHAIN_ID for a devnet)' }, async () => {
  const env = { L2_RPC_URL: LIVE, L2_CHAIN_ID: process.env.L2_LIVE_CHAIN_ID ?? '700770' };
  const res = await handleL2Rpc(req([call('eth_blockNumber', [], 1), call('bloch_finality', [], 2), call('eth_getBlockByNumber', ['finalized', false], 3)]), env);
  assert.equal(res.status, 200);
  const [bn, fin, blk] = await res.json();
  assert.ok(Number.parseInt(bn.result, 16) > 0);
  const f = parseFinality(fin.result, Number.parseInt(bn.result, 16));
  assert.ok(f.finalized === null || f.finalized <= f.latest);
  if (blk.result) assert.equal(Number.parseInt(blk.result.number, 16), f.finalized);
});
