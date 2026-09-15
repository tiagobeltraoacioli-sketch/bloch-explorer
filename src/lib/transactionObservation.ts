// SPDX-License-Identifier: AGPL-3.0-or-later
import { transactionStatus } from "./observatory.ts";
import type { ApiReading } from "./observatory.ts";

/** A remembered node status is useful even without a historical index. Never
 * promote an RPC failure or a stale cache entry into a current confirmation. */
export function transactionObservation(reading: ApiReading<unknown> | null, transportError: string | null) {
  const status = transactionStatus(reading?.data);
  const error = transportError ?? reading?.error?.message ?? (reading?.error ? "Transaction status is unavailable." : null);
  const stale = !!error || reading?.cache?.state === "stale";
  const descriptions = {
    pending: "The observer has this transaction in its local mempool. Inclusion has not been reported.",
    included: "The observer reports this transaction included in its chain. It is not finalized yet.",
    justified: "The observer reports this transaction justified. Finalization has not been reported yet.",
    finalized: "The observer reports this transaction finalized in its current chain view.",
    unknown: "This observer does not currently remember this transaction. This does not prove absence or failure.",
  };
  return {
    status,
    stale,
    error: error ?? (reading && !status ? "The observer returned an unrecognized transaction status." : null),
    description: status ? descriptions[status] : null,
    source: reading?.corroboration?.source_node ?? null,
  };
}
