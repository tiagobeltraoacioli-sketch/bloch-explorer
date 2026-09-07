// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";

/** Same-origin reads, one in flight, with an explicit deadline and backoff.
 * Visibility and pause controls stop the poll; stale values remain labelled. */
export function useLiveRead<T>(url: string, intervalMs = 15_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const trigger = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false, busy = false, failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | null = null;
    const run = async () => {
      if (disposed || busy || document.hidden) return;
      clearTimeout(timer);
      busy = true;
      setLoading(true);
      const ac = new AbortController(); active = ac;
      const deadline = setTimeout(() => ac.abort(), 25_000);
      let retryMs = 0;
      try {
        const response = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
        const retry = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retry) && retry > 0) retryMs = Math.min(retry * 1000, 300_000);
        if (!response.ok) throw new Error(response.status === 429 ? "Read limit reached. Refresh will retry after the cooldown." : `The data service returned HTTP ${response.status}.`);
        const body = await response.json();
        if (!body || typeof body !== "object" || !("data" in body)) throw new Error("The data service returned an unexpected response.");
        if (!disposed) { setData(body as T); setUpdatedAt(Date.now()); setError(null); failures = 0; }
      } catch (e) {
        if (!disposed && !document.hidden) {
          failures++;
          setError(ac.signal.aborted ? "The data service timed out. Showing the last available reading." : e instanceof Error ? e.message : "Unable to read the data service.");
        }
      } finally {
        clearTimeout(deadline); busy = false; active = null;
        if (!disposed) {
          setLoading(false);
          if (!paused && !document.hidden) timer = setTimeout(run, Math.max(retryMs, Math.min(intervalMs * 2 ** Math.min(failures, 3), 120_000)));
        }
      }
    };
    trigger.current = () => { void run(); };
    const visibility = () => {
      clearTimeout(timer);
      if (document.hidden) active?.abort();
      else if (!paused) void run();
    };
    document.addEventListener("visibilitychange", visibility);
    if (!paused) void run();
    else setLoading(false);
    return () => { disposed = true; clearTimeout(timer); active?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [url, intervalMs, paused]);
  const refresh = useCallback(() => trigger.current(), []);
  return { data, error, loading, updatedAt, paused, setPaused, refresh };
}
