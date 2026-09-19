// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Poll only while the page is visible and only after the previous read has
 * settled. The interval is a rest period, so a slow upstream can never create
 * overlapping browser requests.
 */
export function pollWhileVisible(fn: () => void | Promise<unknown>, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let rerun = false;
  let disposed = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clear();
    if (disposed || document.visibilityState !== "visible") return;
    timer = setTimeout(() => void run(), ms);
  };

  const run = async () => {
    if (disposed || document.visibilityState !== "visible") return;
    if (busy) {
      rerun = true;
      return;
    }
    clear();
    busy = true;
    try {
      await fn();
    } catch {
      // Poll owners render their own errors. A rejected tick must not kill the
      // scheduler or become an unhandled promise rejection in the browser.
    } finally {
      busy = false;
      if (disposed || document.visibilityState !== "visible") return;
      if (rerun) {
        rerun = false;
        void run();
      } else {
        schedule();
      }
    }
  };

  const onVis = () => {
    clear();
    if (document.visibilityState === "visible") void run();
    else rerun = false;
  };

  onVis();
  document.addEventListener("visibilitychange", onVis);
  return () => {
    disposed = true;
    rerun = false;
    clear();
    document.removeEventListener("visibilitychange", onVis);
  };
}
