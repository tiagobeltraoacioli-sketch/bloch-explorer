#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A loopback-only mock of `bloch-l2-settled-rpc` for chain 700770 in its state
// of 2026-10-30: the L2 genesis block only (632e45ae…f468), recorded from a
// real settled RPC (edge/tests/fixtures/l2-genesis-700770.json). For local
// previews and screenshots of the /l2 pages; never a network.
//
//   MODE=genesis   safe = finalized = block 0 (the follower verified the L1
//                  block that installed the L2 genesis). Default.
//   MODE=nostatus  the RPC has no follower status yet: safe/finalized null,
//                  bloch_finality null (what a fresh install serves).
//   MODE=ahead     the sequencer executed blocks 1..3 that are not settled:
//                  latest = 3, safe = finalized = 0. The explorer must not
//                  show blocks 1..3.
//
//   PORT=19171 MODE=genesis node scripts/l2-mock-rpc.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../edge/tests/fixtures/l2-genesis-700770.json', import.meta.url)), 'utf8'));
const MODE = process.env.MODE ?? 'genesis';
const PORT = Number(process.env.PORT ?? 19171);
const hx = (n) => '0x' + n.toString(16);

const genesis = fx.block0;
const blocks = [genesis];
if (MODE === 'ahead') {
  for (let n = 1; n <= 3; n++) {
    const prev = blocks[n - 1];
    blocks.push({ ...genesis, number: hx(n), parentHash: prev.hash, hash: '0x' + String(n).repeat(64).slice(0, 64), timestamp: hx(Number(BigInt(genesis.timestamp)) + 30 * n) });
  }
}
const latest = blocks.length - 1;
const safe = MODE === 'nostatus' ? null : 0;
const level = (n) => (n === null ? null : { number: hx(n), hash: blocks[n].hash });

function finality() {
  if (MODE === 'nostatus') return null;
  return { ...fx.bloch_finality, latest: level(latest), safe: level(safe), finalized: level(safe) };
}

function blockAt(ref, full) {
  let n;
  if (ref === 'latest' || ref === 'pending') n = latest;
  else if (ref === 'safe' || ref === 'finalized') n = safe;
  else if (ref === 'earliest') n = 0;
  else if (typeof ref === 'string' && /^0x[0-9a-f]+$/i.test(ref)) n = Number(BigInt(ref));
  if (n === null || n === undefined || !blocks[n]) return null;
  const b = blocks[n];
  return full ? b : { ...b, transactions: b.transactions.map((t) => (typeof t === 'string' ? t : t.hash)) };
}

function answer(c) {
  const p = c.params ?? [];
  switch (c.method) {
    case 'eth_chainId': return fx.chainId;
    case 'net_version': return '700770';
    case 'eth_blockNumber': return hx(latest);
    case 'eth_gasPrice': return genesis.baseFeePerGas;
    case 'bloch_finality': return finality();
    case 'bloch_settlement': return null;
    case 'eth_getBlockByNumber': return blockAt(p[0], p[1] === true);
    case 'eth_getBlockByHash': {
      const b = blocks.find((x) => x.hash === String(p[0]).toLowerCase());
      return b ? blockAt(b.number, p[1] === true) : null;
    }
    case 'eth_getBlockReceipts': {
      const b = typeof p[0] === 'string' && p[0].length === 66 ? blocks.find((x) => x.hash === p[0]) : blockAt(p[0], false);
      return b ? [] : null;
    }
    case 'eth_getBlockTransactionCountByNumber': return blockAt(p[0], false) ? '0x0' : null;
    case 'eth_getTransactionByHash':
    case 'eth_getTransactionReceipt': return null;
    case 'eth_getBalance':
    case 'eth_getTransactionCount': {
      if ((p[1] === 'safe' || p[1] === 'finalized') && safe === null) throw { code: -32000, message: 'unknown block' };
      return '0x0';
    }
    case 'eth_getCode': return '0x';
    case 'eth_call': return '0x';
    case 'eth_getLogs': return [];
    default: throw { code: -32601, message: `the method ${c.method} does not exist/is not available` };
  }
}

function one(c) {
  try {
    return { jsonrpc: '2.0', id: c.id, result: answer(c) };
  } catch (e) {
    return { jsonrpc: '2.0', id: c.id, error: { code: e.code ?? -32603, message: e.message ?? String(e) } };
  }
}

createServer(async (req, res) => {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400); return res.end(); }
  const out = Array.isArray(body) ? body.map(one) : one(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(out));
}).listen(PORT, '127.0.0.1', () => console.log(`mock bloch-l2-settled-rpc (chain 700770, mode ${MODE}) on http://127.0.0.1:${PORT}/`));
