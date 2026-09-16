// SPDX-License-Identifier: AGPL-3.0-or-later
// Gateway-only, opt-in, uncached reads. Never signs, sends or retries.
import { Bucket } from '../edge/governor.js';
import { NATIVE_GATEWAY_METHODS } from '../edge/surface.js';
export const MAINNET_DOMAIN = 'f47d3e498ff978e34471dafff5f94fe139fc3ff489b1a00f469c030258311966';
export const MAINNET_GENESIS = '9953da73a2794e190b1c551a787f39d6486a288f40b69ecc361281d5a893e415';
export const NATIVE_REPLY_LIMIT = 2 * 1024 * 1024;
const hex = (v, bytes) => typeof v === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(v);
const uint = v => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n;
const exact = (o, keys) => o && !Array.isArray(o) && typeof o === 'object' && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
let budget, inFlight = 0;
export function resetNativeGatewayForTests() { budget = undefined; inFlight = 0; }
export function nativeMethod(name) { return NATIVE_GATEWAY_METHODS.includes(name); }
export function validateNativeParams(method, params) {
  if (!Array.isArray(params)) return false;
  if (method === 'getnativepool') return params.length === 1 && hex(params[0], 32);
  if (method === 'getnativebridgestate') return params.length === 2 && params.every(p => hex(p, 32));
  const q = params[0];
  if (params.length !== 1 || !q || !hex(q.ownerPublicKeyHex, 3749)) return false;
  if (method === 'getnativewalletview') return exact(q, ['ownerPublicKeyHex']);
  let hashes, numbers, keys;
  if (method === 'getnativewithdrawalquote') {
    hashes = ['expectedHead', 'route']; numbers = ['amount', 'nonce', 'validUntil'];
    keys = ['ownerPublicKeyHex', ...hashes, ...numbers, 'recipientHex20'];
    if (!hex(q.recipientHex20, 20)) return false;
  } else if (method === 'getnativepoolquote') {
    const spec = {
      'create-pair': [['asset', 'seed'], ['blchAmount', 'nativeAmount']],
      initialize: [['reserve'], ['feeBps', 'minimumLp']],
      swap: [['pool', 'inputAsset'], ['amount', 'minimumOut']],
    }[q.operation];
    if (!spec) return false;
    hashes = ['expectedHead', ...spec[0]]; numbers = ['validUntil', ...spec[1]];
    keys = ['ownerPublicKeyHex', 'operation', ...hashes, ...numbers];
    if (q.operation === 'initialize' && (!uint(q.feeBps) || BigInt(q.feeBps) > 65535n)) return false;
  } else return false;
  return exact(q, keys) && hashes.every(k => hex(q[k], 32)) && numbers.every(k => uint(q[k]));
}
export function nativeActivation(env, now) {
  if (env.NATIVE_WALLET_READS !== 'enabled') return null;
  try {
    const p = JSON.parse(env.NATIVE_WALLET_ACTIVATION);
    if (p.schema !== 'postern.native-gateway-activation.v1' || p.format !== 'BPOSMAN1' || p.domain !== MAINNET_DOMAIN || p.genesis !== MAINNET_GENESIS ||
        !hex(p.head, 32) || !hex(p.stateRoot, 32) || !hex(p.activationProfileSha256, 32) ||
        !uint(p.activationEpoch) || !uint(p.observedEpoch) || BigInt(p.activationEpoch) === 18446744073709551615n || BigInt(p.observedEpoch) < BigInt(p.activationEpoch) ||
        !Number.isSafeInteger(p.observedAt) || !Number.isSafeInteger(p.expiresAt) || p.observedAt < 0 || p.expiresAt < 0 || p.observedAt > now || p.expiresAt <= now || p.expiresAt <= p.observedAt || p.expiresAt - p.observedAt > 300000) return null;
    return p;
  } catch { return null; }
}
export async function forwardNative(payload, opts, env, readBounded) {
  const fail = (code, reason) => ({ jsonrpc: '2.0', id: payload.id, error: { code, message: reason, data: { reason, retryable: false } } });
  const activation = nativeActivation(env, opts.now());
  if (!activation) return fail(-32601, 'native_wallet_disabled_or_activation_unobserved');
  if (!validateNativeParams(payload.method, payload.params)) return fail(-32602, 'invalid_native_params');
  const upstream = env.NATIVE_WALLET_UPSTREAM;
  if (!upstream || !opts.pools.archivals.includes(upstream)) return fail(-32603, 'native_upstream_not_configured_observer');
  budget ||= new Bucket(2, 0.5, opts.now);
  if (inFlight >= 1 || !budget.take(1)) return fail(-32050, 'native_read_capacity');
  inFlight++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await opts.fetchImpl(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), redirect: 'manual', signal: controller.signal });
    if (!response.ok) throw Error('upstream');
    const value = JSON.parse(await readBounded(response.body, NATIVE_REPLY_LIMIT));
    if (value.jsonrpc !== '2.0' || value.id !== payload.id || Object.hasOwn(value, 'result') === Object.hasOwn(value, 'error')) throw Error('envelope');
    if (value.error) {
      if (!Number.isInteger(value.error.code) || typeof value.error.message !== 'string') throw Error('error');
      return value;
    }
    const r = value.result;
    if (!r || r.format !== 'BPOSMAN1' || r.domain !== MAINNET_DOMAIN || r.genesis !== MAINNET_GENESIS || !hex(r.head, 32) || !hex(r.stateRoot, 32) || !uint(r.height)) throw Error('identity');
    if (['getnativewalletview', 'getnativepoolquote', 'getnativewithdrawalquote'].includes(payload.method) && (!r.context || !Array.isArray(r.context.utxos) || r.context.utxos.length > 128 || typeof r.context.nativeSnapshotHex !== 'string' || r.context.nativeSnapshotHex.length > 1048576 || !/^(?:[0-9a-f]{2})+$/.test(r.context.nativeSnapshotHex) || !hex(r.context.nativeCommitmentHex, 32))) throw Error('context');
    if (r.context && (!uint(r.context.epoch) || BigInt(r.context.epoch) < BigInt(activation.activationEpoch))) throw Error('inactive');
    if (payload.method.endsWith('quote') && (typeof r.transactionHex !== 'string' || r.transactionHex.length > 524288 || !/^(?:[0-9a-f]{2})+$/.test(r.transactionHex))) throw Error('packet');
    if (payload.method.endsWith('quote') && r.head !== payload.params[0].expectedHead) throw Error('stale_quote');
    if (!nativeActivation(env, opts.now())) throw Error('expired');
    return { ...value, result: { ...r, finalityVerified: false, trust: 'configured-mainnet-observer-not-finality-proof' }, corroboration: { level: 'uncorroborated', archival_witnesses: 1, fleet_witness: false } };
  } catch { return fail(-32603, 'native_read_unavailable_or_invalid'); }
  finally { clearTimeout(timer); inFlight--; }
}
