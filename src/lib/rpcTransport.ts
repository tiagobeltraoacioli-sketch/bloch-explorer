// SPDX-License-Identifier: AGPL-3.0-or-later
let requestId = 0;
export const G4_ENDPOINTS = ["/rpc", "https://posternlabs.com/g4rpc"] as const;
let primaryRetryAt = 0;

export interface RpcEnvelope<T> {
  jsonrpc: "2.0"; id: number; result?: T;
  error?: { code: number; message: string; data?: { reason?: string; retry_after_ms?: number } };
}

/** A transport failure must never look like a successful undefined result. */
export async function readRpc<T>(method: string, params: unknown[], options: {
  signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch;
} = {}): Promise<RpcEnvelope<T>> {
  const deadline = Date.now() + (options.timeoutMs ?? 25_000);
  const endpoints = Date.now() < primaryRetryAt ? G4_ENDPOINTS.slice(1) : G4_ENDPOINTS;
  let failure: unknown;
  for (const endpoint of endpoints) {
    options.signal?.throwIfAborted();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("RPC request timed out. Try again shortly.");
    try {
      const body = await readEndpoint<T>(endpoint, method, params, {
        ...options, timeoutMs: endpoint === "/rpc" ? Math.min(12_000, remaining) : remaining,
      });
      // A valid RPC error is an answer, including rate limits and divergence.
      // Never search another node for a more convenient application answer.
      if (endpoint !== "/rpc" && body.result && typeof body.result === "object" && !Array.isArray(body.result)) {
        // The wallet proxy has a different corroboration contract. Do not
        // present its soft quorum as the explorer's archival certification.
        body.result = { ...body.result, corroboration: {
          level: "uncorroborated", source: "posternlabs_fallback",
          missing: ["Explorer archival certification unavailable"],
        } };
      }
      return body;
    } catch (error) {
      options.signal?.throwIfAborted();
      failure = error;
      if (endpoint === "/rpc") primaryRetryAt = Date.now() + 60_000;
    }
  }
  throw failure;
}

export function _resetTransportForTests() { primaryRetryAt = 0; }

async function readEndpoint<T>(endpoint: string, method: string, params: unknown[], options: {
  signal?: AbortSignal; timeoutMs: number; fetchImpl?: typeof fetch;
}): Promise<RpcEnvelope<T>> {
  const id = ++requestId;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? 25_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
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
