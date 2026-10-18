#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Local preview of the /l2 explorer pages against any L2 RPC, with the same
// /l2rpc policy the Pages Function runs (edge/l2rpc.js). Serves dist/ with the
// SPA fallback. Nothing is deployed.
//
//   npm run build
//   L2_RPC_URL=http://127.0.0.1:19145/ L2_CHAIN_ID=700771 PORT=19160 \
//     node scripts/l2-explorer-preview.mjs
//   open http://127.0.0.1:19160/l2
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleL2Rpc, describeL2Rpc } from '../edge/l2rpc.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const env = { L2_RPC_URL: process.env.L2_RPC_URL ?? '', L2_CHAIN_ID: process.env.L2_CHAIN_ID ?? '700770' };
const port = Number(process.env.PORT ?? 19160);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/l2rpc') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = req.method === 'POST'
        ? await handleL2Rpc(new Request('http://localhost/l2rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.concat(chunks).length) }, body: Buffer.concat(chunks) }), env)
        : describeL2Rpc(env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let body;
    try {
      body = await readFile(join(root, path));
    } catch {
      path = '/index.html';
      body = await readFile(join(root, path));
    }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
}).listen(port, '127.0.0.1', () => console.log(`L2 explorer preview on http://127.0.0.1:${port}/l2 (upstream ${env.L2_RPC_URL || 'unset'}, chain ${env.L2_CHAIN_ID})`));
