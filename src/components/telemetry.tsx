// SPDX-License-Identifier: AGPL-3.0-or-later
import { FormEvent, useEffect, useRef, useState } from "react";
import { g4rpc, G4Error } from "../lib/g4";
import { transactionStatus, TxStatus } from "../lib/observatory";
import { Link } from "../lib/router";

export function ReadToolbar({ loading, paused, updatedAt, onRefresh, onPause }: {
  loading: boolean; paused: boolean; updatedAt: number | null; onRefresh: () => void; onPause: () => void;
}) {
  return <div className="read-toolbar">
    <span>{updatedAt ? `Read at ${new Date(updatedAt).toLocaleTimeString()}` : "Waiting for data"}</span>
    <button type="button" className="pill-tab" onClick={onPause} aria-pressed={paused}>{paused ? "Resume live" : "Pause"}</button>
    <button type="button" className="pill-tab" onClick={onRefresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh ↻"}</button>
  </div>;
}

export function RawData({ data, label = "Inspect response" }: { data: unknown; label?: string }) {
  return <details className="raw-reading"><summary>{label}</summary><pre>{JSON.stringify(data, null, 2)}</pre></details>;
}

export function TxStatusLookup({ initialHash = "" }: { initialHash?: string }) {
  const [hash, setHash] = useState(initialHash);
  const [result, setResult] = useState<{ status: TxStatus; at: number; source: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const txid = hash.trim().replace(/^0x/i, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(txid)) { setError("Enter a transaction ID with 64 hexadecimal characters."); return; }
    active.current?.abort();
    const ac = new AbortController(); active.current = ac;
    setBusy(true); setError(null); setResult(null);
    try {
      const answer = await g4rpc<{ status: string; corroboration?: { source_node?: string } }>("gettxstatus", [txid], { signal: ac.signal });
      const status = transactionStatus(answer);
      if (!status) throw new Error("The node returned an unrecognized transaction status.");
      if (!ac.signal.aborted) setResult({ status, at: Date.now(), source: answer.corroboration?.source_node ?? null });
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof G4Error && e.code === -32601 ? "Transaction status is unavailable on the responding node version." : e instanceof Error ? e.message : "Unable to read transaction status.");
    } finally { if (!ac.signal.aborted) setBusy(false); }
  };
  return <section className="card tx-status-card">
    <div className="section-heading"><h2>Transaction status</h2><span className="pill quiet">Node observation</span></div>
    <p>Look up the status remembered by an observer. Availability depends on the node version.</p>
    <form onSubmit={submit} className="tx-status-form">
      <label className="tx-status-input">Transaction ID<input value={hash} onChange={e => { setHash(e.target.value); setResult(null); }} placeholder="64-character transaction hash" maxLength={66} spellCheck={false} autoComplete="off" /></label>
      <button type="submit" className="btn" disabled={busy}>{busy ? "Checking…" : "Check status"}</button>
    </form>
    {error && <p role="alert" className="txt-warn">{error}</p>}
    {result && <div className="tx-status-result" role="status"><span className={"pill " + (result.status === "unknown" ? "quiet" : "info")}>{result.status}</span><span>{result.source ?? "Observer"} · {new Date(result.at).toLocaleTimeString()}</span><Link to={`/tx/${hash.trim().replace(/^0x/i, "").toLowerCase()}`}>Transaction details ↗</Link></div>}
    <p className="lookup-hint">“Unknown” does not prove that a transaction is absent. Included, justified and finalized are the observer’s current classifications; this lookup is not a complete transaction index or a proof of finality.</p>
  </section>;
}
