// SPDX-License-Identifier: AGPL-3.0-or-later
// The /l2 explorer's settled-only reads (edge/l2rpc.js), the L1 settlement
// record endpoint (edge/l2status.js) and its decoding (src/lib/l2settlement.ts),
// against the real 2026-10-30 mainnet records in ./fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleL2Rpc, settleCall, boundAnswer, settledOnly, describeL2Rpc, NOT_SETTLED } from '../l2rpc.js';
import { readL2Status, handleL2Status, consensusView, QUORUM } from '../l2status.js';
import { onRequestGet as statusGet } from '../../functions/l2status.js';
import {
  parseL2Settlement, parseL2Status, decodeStatement, isClaimed, withdrawalStage, fmtSats, l2Phase, epochOfSlot, timeOfSlot,
} from '../../src/lib/l2settlement.ts';
import { decodeWithdrawal, settledTip, parseFinality, readHead, OUTBOX, WITHDRAWAL_INITIATED_TOPIC, methodOf } from '../../src/lib/l2.ts';

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const SETTLEMENT = fx('getl2settlement-mainnet-20261030.json').result;
const GENESIS = fx('l2-genesis-700770.json');
const A = '0x72dc623d4c03c996a3d20ed2674f24570e8acf44';
const H = '0x' + 'ab'.repeat(32);
const call = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const req = (body) => new Request('https://blochl1.com/l2rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ENV = { L2_RPC_URL: 'https://l2rpc.example/' };
const hx = (n) => '0x' + n.toString(16);

/**
 * A settled RPC whose sequencer executed blocks 0..latest and whose `safe`
 * block is `safe` (null: no follower status yet).
 */
function chain({ latest = 5, safe = 2 } = {}) {
  const block = (n) => ({ number: hx(n), hash: '0x' + n.toString(16).padStart(64, '0'), transactions: [] });
  const seen = [];
  const f = async (_url, init) => {
    const batch = JSON.parse(init.body);
    seen.push(batch);
    const answer = (c) => {
      const p = c.params;
      const at = (ref) => (ref === 'latest' ? latest : ref === 'safe' || ref === 'finalized' ? safe : typeof ref === 'string' && ref.startsWith('0x') && ref.length < 20 ? Number(ref) : null);
      switch (c.method) {
        case 'eth_chainId': return '0xab162';
        case 'eth_blockNumber': return hx(latest);
        case 'eth_getBlockByNumber': { const n = at(p[0]); return n === null || n > latest ? null : block(n); }
        case 'eth_getTransactionByHash': return { hash: p[0], blockNumber: p[0] === H ? hx(4) : hx(1) };
        case 'eth_getTransactionReceipt': return { transactionHash: p[0], blockNumber: hx(4) };
        case 'eth_getBlockReceipts': return [{ blockNumber: p[0] }];
        case 'eth_getLogs': return [1, 2, 3, 4].map((n) => ({ blockNumber: hx(n), logIndex: '0x0' }));
        case 'eth_getBalance': return `bal@${p[1]}`;
        default: return null;
      }
    };
    return new Response(JSON.stringify(batch.map((c) => ({ jsonrpc: '2.0', id: c.id, result: answer(c) }))), { status: 200 });
  };
  f.seen = seen;
  return f;
}

// ─── settled-only /l2rpc ────────────────────────────────────────────────────

test('settled-only is the default and can be turned off explicitly', () => {
  assert.equal(settledOnly({}), true);
  assert.equal(settledOnly({ L2_SETTLED_ONLY: '1' }), true);
  for (const v of ['0', 'false', 'OFF', 'no']) assert.equal(settledOnly({ L2_SETTLED_ONLY: v }), false, v);
});

test('latest and pending are read as safe; state reads by block hash are refused', () => {
  assert.deepEqual(settleCall(call('eth_getBlockByNumber', ['latest', true])).call.params, ['safe', true]);
  assert.deepEqual(settleCall(call('eth_getBalance', [A, 'pending'])).call.params, [A, 'safe']);
  assert.deepEqual(settleCall(call('eth_getBalance', [A, 'finalized'])).call.params, [A, 'finalized']);
  assert.deepEqual(settleCall(call('eth_getLogs', [{ fromBlock: '0x0', topics: [H] }])).call.params[0], { fromBlock: '0x0', toBlock: 'safe', topics: [H] });
  assert.equal(settleCall(call('eth_getBalance', [A, H])).error.error.code, -32602);
  assert.equal(settleCall(call('eth_getCode', [A, { blockHash: H }])).error.error.code, -32602);
});

test('blocks, transactions, receipts and logs above safe are absent; eth_blockNumber is safe', async () => {
  const f = chain({ latest: 5, safe: 2 });
  const res = await handleL2Rpc(req([
    call('eth_blockNumber', [], 1),
    call('eth_getBlockByNumber', ['0x2', false], 2),
    call('eth_getBlockByNumber', ['0x3', false], 3),
    call('eth_getBlockByNumber', ['latest', false], 4),
    call('eth_getTransactionByHash', [H], 5),
    call('eth_getTransactionByHash', ['0x' + 'cd'.repeat(32)], 6),
    call('eth_getTransactionReceipt', [H], 7),
    call('eth_getBlockReceipts', ['0x4'], 8),
    call('eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest', topics: [H] }], 9),
    call('eth_getBalance', [A, 'latest'], 10),
    call('eth_getBalance', [A, '0x4'], 11),
    call('eth_getBalance', [A, '0x1'], 12),
  ]), ENV, f);
  const out = await res.json();
  const by = Object.fromEntries(out.map((o) => [o.id, o]));
  assert.equal(by[1].result, '0x2');
  assert.equal(by[2].result.number, '0x2');
  assert.equal(by[3].result, null, 'executed but unsettled block hidden');
  assert.equal(by[4].result.number, '0x2', 'latest is read as safe');
  assert.equal(by[5].result, null, 'tx in block 4 hidden');
  assert.equal(by[6].result.blockNumber, '0x1');
  assert.equal(by[7].result, null);
  assert.equal(by[8].result, null);
  assert.deepEqual(by[9].result.map((l) => l.blockNumber), ['0x1', '0x2']);
  assert.equal(by[10].result, 'bal@safe');
  assert.equal(by[11].error.code, NOT_SETTLED);
  assert.equal(by[12].result, 'bal@0x1');
  const batch = f.seen[0];
  assert.equal(batch[0].method, 'eth_chainId');
  assert.deepEqual([batch[1].method, batch[1].params], ['eth_getBlockByNumber', ['safe', false]], 'one safe probe per batch');
  assert.equal(batch.filter((c) => c.id === '__l2_safe_bound__').length, 1);
});

test('with no follower status (safe null) nothing is served as settled', async () => {
  const res = await handleL2Rpc(req([
    call('eth_blockNumber', [], 1),
    call('eth_getBlockByNumber', ['0x0', false], 2),
    call('eth_getBalance', [A, 'safe'], 3),
    call('eth_chainId', [], 4),
  ]), ENV, chain({ latest: 0, safe: null }));
  const out = await res.json();
  assert.equal(out[0].error.code, NOT_SETTLED);
  assert.equal(out[1].result, null);
  assert.equal(out[2].error.code, NOT_SETTLED);
  assert.equal(out[3].result, '0xab162');
});

test('the reserved safe-probe id cannot be used by a caller; GET reports the mode', async () => {
  const res = await handleL2Rpc(req([call('eth_chainId', [], '__l2_safe_bound__')]), ENV, chain());
  assert.equal(res.status, 400);
  assert.equal((await describeL2Rpc(ENV).json()).settledOnly, true);
  assert.equal((await describeL2Rpc({ ...ENV, L2_SETTLED_ONLY: '0' }).json()).settledOnly, false);
  assert.deepEqual(boundAnswer({ id: 1, method: 'eth_getBlockByNumber', params: ['0x0', false] }, { jsonrpc: '2.0', id: 1, error: { code: 1, message: 'x' } }, 0).error.code, 1);
});

test('the recorded genesis-only RPC passes the bound unchanged (safe = finalized = 0)', async () => {
  const f = async (_u, init) => {
    const batch = JSON.parse(init.body);
    const ans = (c) => (c.method === 'eth_chainId' ? GENESIS.chainId : c.method === 'bloch_finality' ? GENESIS.bloch_finality : c.method === 'eth_getBlockByNumber' && ['safe', 'finalized', '0x0'].includes(c.params[0]) ? GENESIS.block0 : null);
    return new Response(JSON.stringify(batch.map((c) => ({ jsonrpc: '2.0', id: c.id, result: ans(c) }))));
  };
  const out = await (await handleL2Rpc(req([call('eth_blockNumber', [], 1), call('eth_getBlockByNumber', ['latest', true], 2), call('bloch_finality', [], 3)]), ENV, f)).json();
  assert.equal(out[0].result, '0x0');
  assert.equal(out[1].result.hash, '0x632e45ae778da371a88dc1ae430193aa77eabb67a11de18e84fea7d20d11f468');
  const fin = parseFinality(out[2].result);
  assert.equal(fin.finalized, 0);
  assert.equal(fin.genesisFinalized, true);
  assert.equal(settledTip(fin), 0);
  assert.equal(settledTip(parseFinality(null)), null);
});

test('client readHead uses the safe tag as the head, never latest', async () => {
  const fin = { ...GENESIS.bloch_finality, latest: { number: '0x7', hash: H } };
  const f = async (_u, init) => {
    const batch = JSON.parse(init.body);
    const ans = (c) => (c.method === 'eth_chainId' ? '0xab162' : c.method === 'bloch_finality' ? fin : c.method === 'eth_getBlockByNumber' ? GENESIS.block0 : null);
    return new Response(JSON.stringify(batch.map((c) => ({ jsonrpc: '2.0', id: c.id, result: ans(c) }))));
  };
  const h = await readHead(f);
  assert.equal(h.head, 0);
  assert.equal(h.finality.latest, 7);
  assert.equal(h.chainId, 700770);
});

// ─── /l2status (L1 getl2settlement, corroborated) ──────────────────────────

const L1ENV = {
  EXPLORER_ARCHIVALS: 'http://a1.example:8080/ http://a2.example:8080/',
  EXPLORER_FLEET: 'http://w1.example:8080/',
};
function l1(map) {
  return async (url) => {
    const host = new URL(url).hostname;
    const v = map[host];
    if (v === undefined || v instanceof Error) throw v ?? new Error('down');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: v }), { status: 200 });
  };
}
const moved = (r, h) => ({ ...r, native_height: h, withdrawals: { ...r.withdrawals, finalized_checkpoint: { ...r.withdrawals.finalized_checkpoint, epoch: r.withdrawals.finalized_checkpoint.epoch + 1 }, release_window: { ...r.withdrawals.release_window, window: 12 } } });

test('three observers on the real record agree; moving fields do not break agreement', async () => {
  const st = await readL2Status(L1ENV, l1({ 'a1.example': SETTLEMENT, 'a2.example': moved(SETTLEMENT, SETTLEMENT.native_height + 1), 'w1.example': SETTLEMENT }));
  assert.equal(st.responding, 3);
  assert.equal(st.agreeing, 3);
  assert.equal(st.corroborated, true);
  assert.equal(st.divergent, false);
  assert.equal(st.settlement.native_height, SETTLEMENT.native_height + 1, 'newest answer of the agreeing group');
  assert.equal(QUORUM, 2);
});

test('a single observer, a divergent one, and a wrong chain are labelled, not hidden', async () => {
  const one = await readL2Status(L1ENV, l1({ 'a1.example': SETTLEMENT }));
  assert.equal(one.corroborated, false);
  assert.equal(one.agreeing, 1);
  assert.equal(one.observers.filter((o) => !o.ok).length, 2);
  const other = { ...SETTLEMENT, inbox: { ...SETTLEMENT.inbox, count: 1, escrow_sat: '500' } };
  const split = await readL2Status(L1ENV, l1({ 'a1.example': SETTLEMENT, 'a2.example': other }));
  assert.equal(split.divergent, true);
  assert.equal(split.corroborated, false);
  const wrong = await readL2Status({ ...L1ENV, L2_CHAIN_ID: '700771' }, l1({ 'a1.example': SETTLEMENT, 'a2.example': SETTLEMENT }));
  assert.equal(wrong.chain_mismatch, true);
  assert.equal(wrong.corroborated, false);
  assert.equal(wrong.settlement, null);
});

test('consensus view drops only the head-moving fields', () => {
  const a = consensusView(SETTLEMENT);
  assert.deepEqual(consensusView(moved(SETTLEMENT, 99_999)), a);
  assert.notDeepEqual(consensusView({ ...SETTLEMENT, accepted: { commitment: 'x', statement: 'y' } }), a);
  assert.equal(consensusView(null), null);
});

test('GET /l2status: 502 when no observer answers, 200 otherwise, cacheable briefly', async () => {
  const down = await handleL2Status(L1ENV, l1({}));
  assert.equal(down.status, 502);
  const up = await handleL2Status(L1ENV, l1({ 'a1.example': SETTLEMENT, 'a2.example': SETTLEMENT }));
  assert.equal(up.status, 200);
  assert.match(up.headers.get('cache-control'), /max-age=15/);
  const body = await up.json();
  assert.equal(body.settlement.chain_id, 700770);
  const bad = await handleL2Status({ EXPLORER_ARCHIVALS: 'ftp://x/' }, l1({}));
  assert.equal(bad.status, 500);
  assert.equal(typeof statusGet, 'function');
});

// ─── decoding the record (src/lib/l2settlement.ts) ──────────────────────────

test('the real 2026-10-30 record: activated at slot 187200, nothing settled, empty escrow', () => {
  const r = parseL2Settlement(SETTLEMENT);
  assert.equal(r.chainId, 700770);
  assert.equal(r.activated, true);
  assert.equal(r.depositsEnabled, true);
  assert.equal(r.source.slot, 187200);
  assert.equal(epochOfSlot(r.source.slot), 5850);
  assert.equal(timeOfSlot(187200), 1792272679);
  assert.equal(r.accepted, null);
  assert.equal(r.inbox.escrowSat, '0');
  assert.equal(r.withdrawals.count, 0);
  assert.equal(r.withdrawals.attestorSet, '1c06adbb7fef042f58d7efd11587689e324c036c3b467081a63b1cf79caccc4b');
  assert.equal(fmtSats(r.withdrawals.attestedClaimSat), '100 BLCH');
  assert.equal(fmtSats(r.withdrawals.releaseWindow.capSat), '10 BLCH');
  assert.equal(r.withdrawals.escrowConserved, true);
  assert.equal(l2Phase(r, true), 'activated-unsettled');
  assert.equal(l2Phase(null, true), 'not-installed');
  assert.equal(l2Phase(null, false), 'unknown');
  const env = parseL2Status({ expected_chain_id: 700770, responding: 3, agreeing: 3, quorum: 2, corroborated: true, observers: [{}, {}, {}], settlement: SETTLEMENT });
  assert.equal(env.corroborated, true);
  assert.equal(env.record.source.height, 1);
});

function statementV3({ chainId = 700770, l2 = 12, slot = 230000, consumed = [0, 2], wCount = 3 } = {}) {
  const b = new Uint8Array(766);
  b.set(new TextEncoder().encode('BLOCH:EVM:SETTLEMENT:3'));
  const u64 = (o, v) => { let x = BigInt(v); for (let i = 7; i >= 0; i--) { b[22 + o + i] = Number(x & 0xffn); x >>= 8n; } };
  const h = (o, byte) => b.fill(byte, 22 + o, 22 + o + 32);
  u64(256, chainId); u64(264, l2); h(336, 0x11); h(368, 0x22); h(400, 0x33); u64(432, slot); u64(440, 77);
  u64(512, 2); u64(520, consumed[0]); u64(528, consumed[1]);
  u64(664, 1); h(672, 0x44); u64(704, wCount); h(712, 0x55);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

test('an accepted V3 statement decodes at the pinned offsets', () => {
  const s = decodeStatement(statementV3());
  assert.equal(s.version, 3);
  assert.equal(s.chainId, 700770);
  assert.equal(s.l2Number, 12);
  assert.equal(s.l2HeaderHash, '11'.repeat(32));
  assert.equal(s.l2StateRoot, '22'.repeat(32));
  assert.equal(s.l1SourceBlock, '33'.repeat(32));
  assert.equal(s.l1SourceSlot, 230000);
  assert.equal(s.l1SourceHeight, 77);
  assert.deepEqual([s.inboxCount, s.consumedStart, s.consumedEnd], [2, 0, 2]);
  assert.equal(s.userTxCount, 1);
  assert.equal(s.withdrawalRoot, '44'.repeat(32));
  assert.equal(s.withdrawalCount, 3);
  assert.equal(s.daCommitment, '55'.repeat(32));
  assert.equal(decodeStatement(statementV3().slice(0, -2)), null, 'wrong length');
  assert.equal(decodeStatement('zz'), null);
  const rec = parseL2Settlement({ ...SETTLEMENT, accepted: { commitment: 'ab'.repeat(32), statement: statementV3() } });
  assert.equal(rec.accepted.statement.l2Number, 12);
  assert.equal(l2Phase(rec, true), 'settling');
});

test('claimed bitmap and withdrawal stages', () => {
  const words = new Map([[0, '05' + '00'.repeat(31)], [1, '0080' + '00'.repeat(30)]]);
  assert.equal(isClaimed(0, 0, words), true);
  assert.equal(isClaimed(1, 0, words), false);
  assert.equal(isClaimed(2, 0, words), true);
  assert.equal(isClaimed(256 + 15, 0, words), true);
  assert.equal(isClaimed(300, 0, words), false);
  assert.equal(isClaimed(3, 4, new Map()), true, 'below the floor');
  const rec = parseL2Settlement({
    ...SETTLEMENT,
    withdrawals: { ...SETTLEMENT.withdrawals, count: 5, claimable: { l2_number: 9, root: 'aa', count: 3, height: 10, finalized: true }, claimed: { count: 1, floor: 1, words: [] } },
  });
  assert.deepEqual([0, 1, 3, 5].map((n) => withdrawalStage(n, rec)), ['claimed', 'claimable', 'settled', 'initiated']);
  assert.equal(withdrawalStage(0, null), 'initiated');
  assert.equal(fmtSats('123456789'), '1.23456789 BLCH');
  assert.equal(fmtSats(null), 'not reported');
});

test('outbox WithdrawalInitiated logs decode; look-alikes do not', () => {
  const log = {
    address: OUTBOX,
    topics: [WITHDRAWAL_INITIATED_TOPIC, '0x' + '0'.repeat(63) + '7', '0x' + 'be'.repeat(32)],
    data: '0x' + '0'.repeat(24) + A.slice(2) + (10n ** 18n).toString(16).padStart(64, '0'),
    blockNumber: '0x2', transactionHash: H, logIndex: '0x0',
  };
  const w = decodeWithdrawal(log);
  assert.equal(w.nonce, 7);
  assert.equal(w.sender, A);
  assert.equal(w.amountWei, 10n ** 18n);
  assert.equal(w.l1Recipient, 'be'.repeat(32));
  assert.equal(decodeWithdrawal({ ...log, address: A }), null, 'same event from another contract');
  assert.equal(decodeWithdrawal({ ...log, data: '0x' + 'f'.repeat(128) }), null, 'dirty address word');
  assert.equal(methodOf('0xb769844a' + 'be'.repeat(32)), 'initiateWithdrawal(bytes32)');
});
