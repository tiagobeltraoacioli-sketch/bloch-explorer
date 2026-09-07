// SPDX-License-Identifier: AGPL-3.0-or-later
let requestId = 0;

export interface RpcEnvelope<T> {
  jsonrpc: "2.0"; id: number; result?: T;
  error?: { code: number; message: string; data?: { reason?: string; retry_after_ms?: number } };
}

/** A transport failure must never look like a successful undefined result. */
export async function readRpc<T>(method: string, params: unknown[], options: {
  signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch;
} = {}): Promise<RpcEnvelope<T>> {
  const id = ++requestId;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? 25_000);
  try {
    const response = await (options.fetchImpl ?? fetch)("/rpc", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: controller.signal,
    });
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`RPC returned an unreadable response (HTTP ${response.status}).`); }
    if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || body.id !== id ||
      (Object.prototype.hasOwnProperty.call(body, "result") === Object.prototype.hasOwnProperty.call(body, "error"))) {
      throw new Error("RPC returned an invalid JSON-RPC response.");
    }
    if ("error" in body && (!body.error || typeof body.error !== "object" || typeof body.error.code !== "number" || typeof body.error.message !== "string")) throw new Error("RPC returned a malformed error.");
    // A JSON-RPC error at HTTP 429 remains actionable by the caller.
    if (!response.ok && !body.error) throw new Error(`RPC request failed (HTTP ${response.status}).`);
    return body;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error("RPC request timed out. Try again shortly.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
