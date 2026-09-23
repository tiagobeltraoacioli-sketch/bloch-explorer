// SPDX-License-Identifier: AGPL-3.0-or-later
import { handleApi } from './api.js';
import { Bucket } from './governor.js';

const HASH = /^[0-9a-f]{64}$/i;
const INDEXER = 'http://139.180.166.5.nip.io:8080/indexer/';
const budget = new Bucket(40, 15, Date.now);

export async function transactionDetails(txid, opts, fetchImpl = fetch) {
  if (!HASH.test(txid)) return { status: 400, body: { error: 'txid must be 64 hexadecimal characters' } };
  if (!budget.take()) return { status: 429, body: { error: 'Transaction lookup read budget exceeded' } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const [indexResponse, headResponse] = await Promise.all([
      fetchImpl(INDEXER + 'tx/' + txid.toLowerCase(), { signal: controller.signal, redirect: 'manual', headers: { accept: 'application/json' } }),
      handleApi('/api/v1/status', new URLSearchParams(), opts),
    ]);
    if (indexResponse.status === 404) return { status: 404, body: { error: 'Transaction is not in the canonical archival index; pending status is unknown', txid } };
    if (!indexResponse.ok || !indexResponse.headers.get('content-type')?.includes('application/json')) {
      return { status: 503, body: { error: 'Historical transaction index is unavailable' } };
    }
    const raw = await indexResponse.text();
    if (raw.length > 4 * 1024 * 1024) return { status: 502, body: { error: 'Historical transaction receipt exceeds size limit' } };
    const receipt = JSON.parse(raw);
    if (receipt.txid?.toLowerCase() !== txid.toLowerCase() || !Array.isArray(receipt.inputs) ||
        !Array.isArray(receipt.outputs) || !Number.isSafeInteger(receipt.height) ||
        !Number.isSafeInteger(receipt.slot)) {
      return { status: 503, body: { error: 'Historical transaction receipt is incomplete' } };
    }
    const head = headResponse.body?.data;
    const level = headResponse.body?.corroboration?.level;
    if (headResponse.status !== 200 || !['corroborated', 'final'].includes(level) ||
        !Number.isSafeInteger(head?.height) || !Number.isSafeInteger(head?.slot) ||
        !Number.isSafeInteger(head?.finalized_height) || !Number.isSafeInteger(receipt.as_of_height) ||
        !Number.isSafeInteger(receipt.as_of_slot) || head.height < receipt.as_of_height ||
        head.slot < receipt.as_of_slot || head.slot - receipt.as_of_slot > 2) {
      return { status: 503, body: { error: 'Fresh corroborated finality status is unavailable' } };
    }
    const finalized = receipt.height <= head.finalized_height;
    return { status: 200, body: {
      ...receipt,
      confirmations: head.height - receipt.height + 1,
      status: finalized ? 'finalized' : 'confirmed',
      finalized,
      finalized_height: head.finalized_height,
      observed_head_height: head.height,
      observed_head_slot: head.slot,
      corroboration: level,
    } };
  } catch {
    return { status: 503, body: { error: 'Transaction lookup is temporarily unavailable' } };
  } finally { clearTimeout(timer); }
}
