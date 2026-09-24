// SPDX-License-Identifier: AGPL-3.0-or-later
// Production build + read-only public sources. PLAYWRIGHT_MODULE points to an
// installed Playwright package; CHROME_PATH is optional. No fixtures on the UI.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const root = path.resolve('dist');
const cache = new Map();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/research') {
      const response = await fetch(`https://blochl1.com/research${url.search}`);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (/^\/(rpc|g4|indexer|api)(\/|$)/.test(url.pathname)) {
      const chunks = []; for await (const part of req) chunks.push(part);
      const body = Buffer.concat(chunks).toString(); const key = req.url + body;
      let value = cache.get(key);
      if (!value) {
        const response = await fetch(`https://blochl1.com${req.url}`, { method: req.method, headers: { 'content-type': 'application/json' }, ...(body ? { body } : {}), signal: AbortSignal.timeout(20000) });
        value = { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
        if (response.ok) cache.set(key, value);
      }
      delete value.headers['content-encoding']; delete value.headers['content-length']; delete value.headers['transfer-encoding'];
      res.writeHead(value.status, value.headers); res.end(value.body); return;
    }
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html'); res.end(fs.readFileSync(file));
  } catch (error) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 1100 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.atlas-main-graph [data-node]').length > 10 && document.querySelectorAll('.atlas-matrix [tabindex]').length > 50, null, { timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('.atlas-graph-grid .atlas-panel:nth-child(3) [data-node]').length > 3, null, { timeout: 45000 });
  const nodes = await page.locator('.atlas-main-graph [data-node]').count();
  await page.locator('.atlas-main-graph [data-node]').first().click();
  if (!await page.locator('.atlas-main-graph .atlas-graph-inspector a').isVisible()) throw new Error('Graph inspector did not open');
  await page.getByRole('button', { name: 'Zoom in Bloch transaction and outpoint evidence graph', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Bloch transaction and outpoint evidence graph', exact: true }).click();
  await page.locator('.atlas-main-graph [data-node]').first().focus();
  await page.keyboard.press('Enter');
  if (!await page.locator('.atlas-main-graph .atlas-graph-inspector a').isVisible()) throw new Error('Keyboard graph selection failed');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Scripts', exact: true }).click();
  if (await page.locator('.atlas-main-graph [data-node]').count() === 0) throw new Error('Script graph empty');
  await page.getByRole('button', { name: 'eUTXO', exact: true }).click();
  await page.locator('.atlas-filter select').selectOption({ index: 1 });
  await page.locator('.atlas-filter select').selectOption('all');
  await page.getByRole('button', { name: '7d', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.atlas-matrix [tabindex]').length === 169);
  await page.getByRole('button', { name: '24h', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.atlas-matrix [tabindex]').length === 97);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export observations CSV' }).click();
  const download = await downloadPromise; await download.saveAs('/private/tmp/bloch-atlas-observations.csv');
  if (!fs.readFileSync('/private/tmp/bloch-atlas-observations.csv', 'utf8').startsWith('time_utc,connections,reporting_nodes')) throw new Error('CSV header mismatch');
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  await page.screenshot({ path: '/private/tmp/bloch-atlas-desktop-full.png', fullPage: true });
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: '/private/tmp/bloch-atlas-desktop.png' });
  await page.getByRole('button', { name: 'Switch to the light theme', exact: true }).click();
  await page.screenshot({ path: '/private/tmp/bloch-atlas-light.png' });
  await page.getByRole('button', { name: 'Switch to the dark theme', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile horizontal overflow');
  await page.screenshot({ path: '/private/tmp/bloch-atlas-mobile.png', fullPage: true });
  // Upstream outage must preserve the full shell and explicit unavailable state.
  await page.route('**/research?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test source outage"}' }));
  await page.getByRole('button', { name: '6h', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.atlas-warning')?.textContent.includes('Shared telemetry unavailable'));
  if (await page.locator('.atlas-panel').count() !== 10) throw new Error('Outage erased the atlas shell');
  if (errors.length) throw new Error(errors.join('; '));
  console.log(JSON.stringify({ graphNodes: nodes, panels: 10, desktop: '1512px', mobile: '390px', themes: 2, graphSelection: 'passed', filters: 'passed', csv: 'passed', sourceOutage: 'passed', browserErrors: errors }));
} finally { await browser.close(); server.close(); }
