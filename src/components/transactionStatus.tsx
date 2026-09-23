// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { useLiveRead } from "../lib/liveRead";
import type { ApiReading } from "../lib/observatory";
import { transactionObservation } from "../lib/transactionObservation";
import { appendTxLifecycleEvent, type TxLifecycleEvent } from "../lib/txLifecycle";
import { ReadToolbar } from "./telemetry";
import "../tx-lifecycle.css";

const stages = ["pending", "included", "justified", "finalized"] as const;

export function TransactionStatus({ hash }: { hash: string }) {
  const live = useLiveRead<ApiReading<unknown>>(`/api/v1/tx-status/${hash}`);
  const observation = transactionObservation(live.data, live.error);
  const [events, setEvents] = useState<TxLifecycleEvent[]>([]);
  const status = observation.status;
  const source = observation.source ?? "Unnamed observer";
  const cacheSalt = live.data?.chain?.cache_salt ?? null;
  const cacheAge = live.data?.cache?.age_ms;
  useEffect(() => {
    if (!status || observation.stale || live.updatedAt === null) return;
    const at = live.updatedAt - (typeof cacheAge === "number" && cacheAge >= 0 ? cacheAge : 0);
    setEvents(previous => appendTxLifecycleEvent(previous, { status, at, source, cacheSalt }));
  }, [status, observation.stale, source, cacheSalt, cacheAge, live.updatedAt]);
  const currentStage = observation.stale ? -1 : stages.indexOf(status as typeof stages[number]);
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
    <div className="tx-lifecycle">
      <h3>Transaction lifecycle</h3>
      <ol className="tx-lifecycle-rail" aria-label="Protocol status order">
        {stages.map((stage, index) => <li key={stage} className={index === currentStage ? "is-current" : index < currentStage ? "is-prior" : ""} aria-current={index === currentStage ? "step" : undefined}>{stage}</li>)}
      </ol>
      <p className="tx-lifecycle-note">The highlighted step is the current observer report. Earlier steps show protocol order; their timing is known only if recorded below. An “unknown” report means this observer has no current record.</p>
      {events.length ? <ol className="tx-lifecycle-events" aria-label="Statuses observed during this visit">
        {events.map((event, index) => <li key={`${event.at}:${event.status}:${index}`}>
          <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString()}</time>
          <strong>{event.status}</strong>
          <span>{event.source}{event.cacheSalt === null ? "" : ` · lineage ${event.cacheSalt}`}</span>
        </li>)}
      </ol> : <p className="tx-lifecycle-note">No fresh status has been recorded during this visit yet.</p>}
      <p className="tx-lifecycle-note">This event list exists only in this open tab. Different observers may report different states; a later “unknown” report does not prove that a finalized transaction was reversed.</p>
    </div>
  </section>;
}
