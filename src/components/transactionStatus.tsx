// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLiveRead } from "../lib/liveRead";
import type { ApiReading } from "../lib/observatory";
import { transactionObservation } from "../lib/transactionObservation";
import { ReadToolbar } from "./telemetry";

export function TransactionStatus({ hash }: { hash: string }) {
  const live = useLiveRead<ApiReading<unknown>>(`/api/v1/tx-status/${hash}`);
  const observation = transactionObservation(live.data, live.error);
  return <section className="card tx-status-card" aria-label="Transaction observation">
    <div className="section-heading">
      <h2>Transaction status</h2>
      <ReadToolbar {...live} onRefresh={live.refresh} onPause={() => live.setPaused(!live.paused)} />
    </div>
    {observation.error && <p className="errbox" role="alert">{observation.error}</p>}
    {observation.status ? <>
      <div className="tx-status-result" role="status">
        <span className={`pill ${observation.stale ? "warn" : observation.status === "unknown" ? "quiet" : "info"}`}>
          {observation.stale ? "Previous observation: " : ""}{observation.status}
        </span>
        <span>{observation.source ?? "Observer"} · Node observation</span>
      </div>
      <p>{observation.stale ? "This is an earlier reading. Refresh to obtain the current transaction status." : observation.description}</p>
    </> : !observation.error && <p>{live.loading ? "Looking up this transaction…" : "Waiting for a transaction status reading."}</p>}
    <p className="lookup-hint">Updates every 15 seconds while this page is visible. Status is reported by an observer; it is not an independently verified proof of finality.</p>
  </section>;
}
