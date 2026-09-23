// SPDX-License-Identifier: AGPL-3.0-or-later
import type { TxStatus } from "./observatory";

export interface TxLifecycleEvent {
  status: TxStatus;
  at: number;
  source: string;
  cacheSalt: number | null;
}

/** Only actual fresh readings enter this tab-local history. A change of
 * observer or cache lineage is visible even when the status word is unchanged. */
export function appendTxLifecycleEvent(history: TxLifecycleEvent[], event: TxLifecycleEvent): TxLifecycleEvent[] {
  const previous = history.at(-1);
  if (previous && previous.status === event.status && previous.source === event.source && previous.cacheSalt === event.cacheSalt) return history;
  return [...history, event].slice(-24);
}
