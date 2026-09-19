// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState, useCallback } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

// Run an async loader, optionally polling every `intervalMs`. Keeps prior data
// visible while refreshing, never overlaps reads, sleeps with the tab and
// backs off repeated failures instead of turning an outage into traffic.
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: any[] = [],
  intervalMs = 0
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  const triggerRef = useRef<() => void>(() => {});
  loaderRef.current = loader;

  useEffect(() => {
    // This state belongs to one dependency generation. Keeping it local stops
    // a slow response from the previous route/query overwriting the new one.
    let disposed = false;
    let busy = false;
    let rerun = false;
    let failures = 0;
    let timer: number | undefined;

    const schedule = () => {
      window.clearTimeout(timer);
      if (disposed || intervalMs <= 0 || document.hidden) return;
      const delay = Math.min(intervalMs * 2 ** Math.min(failures, 3), 120_000);
      timer = window.setTimeout(() => void run(), delay);
    };

    const run = async () => {
      if (disposed || document.hidden) return;
      if (busy) {
        // Several refresh clicks during one read become exactly one follow-up.
        rerun = true;
        return;
      }
      window.clearTimeout(timer);
      busy = true;
      setLoading(true);
      try {
        const next = await loaderRef.current();
        if (disposed) return;
        setData(next);
        setError(null);
        failures = 0;
      } catch (e: any) {
        if (disposed) return;
        failures += 1;
        setError(e?.message || String(e));
      } finally {
        busy = false;
        if (!disposed) {
          setLoading(false);
          if (rerun) {
            rerun = false;
            void run();
          } else {
            schedule();
          }
        }
      }
    };

    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) void run();
    };

    triggerRef.current = () => { void run(); };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) void run();
    else setLoading(false);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs]);

  const refresh = useCallback(() => triggerRef.current(), []);
  return { data, error, loading, refresh };
}
