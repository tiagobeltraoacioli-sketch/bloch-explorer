// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Link } from "../lib/router";
import { IndexedTxAmbiguity, indexedHistory, indexedScriptBalance, indexedTransaction, indexedTransactions } from "../lib/indexer";
import { graphusBalance, graphusHeat, graphusHistory, graphusNeighbors, graphusPage, graphusTransaction, type GraphusBalance, type GraphusHistory, type GraphusIo, type GraphusTransaction } from "../lib/graphus";
import { classify } from "../lib/scriptHash";
import { pollWhileVisible } from "../lib/polling";
import { fmtInt } from "../lib/format";
import { HolderOculum } from "../components/HolderOculum";
import "../graphus.css";

type GraphusPage = NonNullable<ReturnType<typeof graphusPage>>;
type Focus = { side: "input" | "output"; index: number } | null;
const short = (value: string) => `${value.slice(0, 10)}…${value.slice(-6)}`;
const amount = (value: string) => `${BigInt(value).toLocaleString()} sat`;

function Graph({ tx }: { tx: GraphusTransaction }) {
  const inputs = tx.inputs.slice(0, 4), outputs = tx.outputs.slice(0, 4);
  const y = (index: number, total: number) => 60 + (index + 1) * 260 / (total + 1);
  return <div className="graphus-map" role="group" aria-label={`Transaction ${tx.txid} consumes ${tx.inputs.length} input outpoints and creates ${tx.outputs.length} outputs. Each point opens its outpoint. Lines show transaction structure, not address ownership or direct value paths.`}>
    <div className="graphus-map-head"><span>INPUT OUTPOINTS</span><span>TRANSACTION / S{fmtInt(tx.slot)}</span><span>CREATED OUTPUTS</span></div>
    <svg viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet">
      <g className="graphus-map-links">
        {inputs.map((_, index) => <path key={`i-${index}`} d={`M145 ${y(index, inputs.length)}L400 190`} />)}
        {outputs.map((_, index) => <path key={`o-${index}`} d={`M400 190L655 ${y(index, outputs.length)}`} />)}
      </g>
      <g className="graphus-map-nodes">
        {inputs.map((io, index) => io.txid && <a key={`i-${index}`} href={`/outpoint/${io.txid}/${io.vout}`} aria-label={`Open input ${index + 1} outpoint ${io.txid}:${io.vout}`}><circle cx="145" cy={y(index, inputs.length)} r="20" /><text x="145" y={y(index, inputs.length) + 5} textAnchor="middle">I{index + 1}</text></a>)}
        {outputs.map((io, index) => <a key={`o-${index}`} href={`/outpoint/${tx.txid}/${io.vout}`} aria-label={`Open output ${io.vout} outpoint ${tx.txid}:${io.vout}`}><circle cx="655" cy={y(index, outputs.length)} r="20" /><text x="655" y={y(index, outputs.length) + 5} textAnchor="middle">O{index + 1}</text></a>)}
      </g>
      <a href={`/tx/${tx.txid}`} aria-label={`Open transaction ${tx.txid}`}><circle className="graphus-map-core" cx="400" cy="190" r="43" /><text className="graphus-map-core-label" x="400" y="196" textAnchor="middle">TX</text></a>
      <text className="graphus-map-caption" x="400" y="265" textAnchor="middle">{short(tx.txid)}</text>
      {tx.inputs.length > 4 && <text className="graphus-map-extra" x="145" y="360" textAnchor="middle">+{tx.inputs.length - 4} more inputs</text>}
      {tx.outputs.length > 4 && <text className="graphus-map-extra" x="655" y="360" textAnchor="middle">+{tx.outputs.length - 4} more outputs</text>}
    </svg>
    <p>Each line meets this transaction only. It does not assert a path between a particular input and output.</p>
  </div>;
}

function IoList({ tx, side, focus, onFocus }: { tx: GraphusTransaction; side: "input" | "output"; focus: Focus; onFocus: (value: Focus) => void }) {
  const items = side === "input" ? tx.inputs : tx.outputs;
  return <div className="graphus-io-column">
    <h3>{side === "input" ? "Consumed input outpoints" : "Created outputs"} <small>{fmtInt(items.length)}</small></h3>
    <div className="graphus-io-scroll" role="list">
      {items.length ? items.slice(0, 24).map((io, index) => <button type="button" role="listitem" key={`${side}-${index}`} className={focus?.side === side && focus.index === index ? "is-selected" : ""} onClick={() => onFocus({ side, index })}>
        <span>{side === "input" ? `Input ${index + 1}` : `Output ${io.vout}`}</span>
        <strong>{amount(io.valueSat)}</strong>
        <small>{io.txid ? `${short(io.txid)}:${io.vout}` : "Outpoint reference unavailable"}</small>
      </button>) : <p>No {side === "input" ? "input outpoints" : "outputs"} recorded for this transaction.</p>}
      {items.length > 24 && <p>Showing 24 of {fmtInt(items.length)}. Open the transaction receipt for the complete list.</p>}
    </div>
  </div>;
}

function Evidence({ tx, focus, asOfSlot, source, verification, onTrace }: { tx: GraphusTransaction; focus: Focus; asOfSlot: number | null; source: string | null; verification: string | null; onTrace: (scriptHash: string) => void }) {
  const io: GraphusIo | null = focus ? (focus.side === "input" ? tx.inputs : tx.outputs)[focus.index] ?? null : null;
  return <section className="card graphus-evidence" aria-live="polite">
    <span className="eyebrow">SOURCE RECORD</span>
    <h3>{io ? `${focus!.side === "input" ? "Consumed outpoint" : "Created output"} ${io.vout}` : "Choose an input or output"}</h3>
    {io ? <dl>
      <div><dt>Exact amount</dt><dd>{amount(io.valueSat)}</dd></div>
      <div><dt>Script hash</dt><dd><code>{io.scriptHash}</code></dd></div>
      <div><dt>Outpoint</dt><dd>{io.txid ? <Link to={`/outpoint/${io.txid}/${io.vout}`} className="mono-link">{short(io.txid)}:{io.vout} ↗</Link> : "Reference unavailable"}</dd></div>
      <div><dt>Meaning</dt><dd>{focus!.side === "input" ? "This transaction consumes the referenced output." : "This transaction creates this output."}</dd></div>
    </dl> : <p>Select a record to inspect its exact satoshis, script hash and outpoint. Script hashes do not identify people or prove common ownership.</p>}
    {io && <button className="btn btn-sm graphus-trace-button" type="button" onClick={() => onTrace(io.scriptHash)}>Trace this script reference ↓</button>}
    <div className="graphus-provenance"><span>BLOCK H{fmtInt(tx.height)} · S{fmtInt(tx.slot)}</span><span>{asOfSlot !== null ? `INDEXED AS OF S${fmtInt(asOfSlot)}` : "INDEXER SNAPSHOT"}</span></div>
    {source && <small>Source: {source}. {verification ? `Verification: ${verification}. ` : ""}This panel does not add Graphus scoring or identity labels.</small>}
  </section>;
}

function ScriptConstellation({ initialScript }: { initialScript: string | null }) {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<GraphusHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sampled, setSampled] = useState<GraphusTransaction[]>([]);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [balances, setBalances] = useState<Record<string, GraphusBalance>>({});
  const [balanceBusy, setBalanceBusy] = useState(false);
  const generation = useRef(0);
  const load = async (input: string) => {
    const reference = classify(input);
    if (reference.kind !== "script_hash" && reference.kind !== "g3_address" && reference.kind !== "g3_hash160") {
      setError(reference.kind === "bad_address" ? "The Bloch address checksum is invalid." : "Enter a 64-character script hash or a valid carried Bloch address.");
      return;
    }
    const current = ++generation.current;
    setBusy(true); setError(null);
    try {
      const result = graphusHistory(await indexedHistory(reference.scriptHash, null, 16), reference.scriptHash);
      if (!result) throw new Error("The historical index returned an invalid script history.");
      if (current === generation.current) {
        setHistory(result); setQuery(input); setSampled([]); setSampleBusy(true); setBalances({}); setBalanceBusy(true);
        const location = new URL(window.location.href);
        location.searchParams.set("script", result.scriptHash);
        window.history.replaceState(window.history.state, "", location);
      }
      const seen = new Set<string>();
      const sampleEvents = result.events.filter(event => {
        const id = event.transactionId ?? (event.kind === "created" ? event.txid : null);
        const key = `${id}:${event.blockId ?? event.slot}`;
        if (!id || seen.has(key)) return false;
        seen.add(key); return true;
      }).slice(0, 4);
      const receipts = await Promise.allSettled(sampleEvents.map(async event => {
        const id = event.transactionId ?? event.txid;
        try { return graphusTransaction(await indexedTransaction(id)); }
        catch (cause) {
          if (cause instanceof IndexedTxAmbiguity) return cause.matches.map(graphusTransaction).find(record => record?.slot === event.slot && record.height === event.height && (!event.blockId || record.blockId === event.blockId)) ?? null;
          throw cause;
        }
      }));
      const validReceipts = receipts.flatMap((receipt, index) => receipt.status === "fulfilled" && receipt.value?.slot === sampleEvents[index].slot && receipt.value.height === sampleEvents[index].height && (!sampleEvents[index].blockId || receipt.value.blockId === sampleEvents[index].blockId) ? [receipt.value] : []);
      if (current === generation.current) { setSampled(validReceipts); setSampleBusy(false); }
      const references = [result.scriptHash, ...graphusNeighbors(result.scriptHash, validReceipts).slice(0, 8).map(node => node.scriptHash)];
      const snapshots = await Promise.allSettled(references.map(async scriptHash => graphusBalance(await indexedScriptBalance(scriptHash), scriptHash)));
      if (current === generation.current) {
        const found: Record<string, GraphusBalance> = {};
        snapshots.forEach((snapshot, index) => { if (snapshot.status === "fulfilled" && snapshot.value) found[references[index]] = snapshot.value; });
        setBalances(found); setBalanceBusy(false);
      }
    } catch (cause) {
      if (current === generation.current) { setError(cause instanceof Error ? cause.message : "Script history is unavailable."); setSampleBusy(false); setBalanceBusy(false); }
    } finally { if (current === generation.current) setBusy(false); }
  };
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("script");
    if (initialScript || fromUrl) void load(initialScript ?? fromUrl!);
  }, [initialScript]);
  const pivot = (event: MouseEvent<HTMLAnchorElement>, scriptHash: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void load(scriptHash);
  };
  const events = history?.events.slice(0, 12) ?? [];
  const neighbors = history ? graphusNeighbors(history.scriptHash, sampled).slice(0, 8) : [];
  const visibleBalances = history ? [history.scriptHash, ...neighbors.map(node => node.scriptHash)].map(scriptHash => balances[scriptHash]).filter((balance): balance is GraphusBalance => Boolean(balance)) : [];
  const maxBalance = visibleBalances.reduce((max, balance) => BigInt(balance.balanceSat) > max ? BigInt(balance.balanceSat) : max, 0n).toString();
  const balanceTotal = visibleBalances.reduce((total, balance) => total + BigInt(balance.balanceSat), 0n).toString();
  const balanceHeights = [...new Set(visibleBalances.map(balance => balance.height))];
  const heatClass = (scriptHash: string) => {
    const balance = balances[scriptHash];
    if (!balance) return "graphus-heat-unknown";
    const intensity = graphusHeat(balance.balanceSat, maxBalance).intensity;
    return `graphus-heat-${intensity === 0 ? 0 : Math.min(4, Math.ceil(intensity * 4))}`;
  };
  return <section className="graphus-script-section" id="graphus-script" aria-labelledby="graphus-script-title">
    <div className="graphus-recent-head"><div><span className="eyebrow">SCRIPT REFERENCE / EVENT FAN</span><h2 id="graphus-script-title">Constellation of recorded events.</h2></div><span>Created and spent eUTXOs · one script hash</span></div>
    <p className="lookup-hint">A script hash groups indexed output records. It does not identify a person, a wallet owner, or an input-to-output value path.</p>
    <form className="graphus-lookup" onSubmit={event => { event.preventDefault(); void load(query); }}>
      <label htmlFor="graphus-script-query">Bloch script hash or carried address</label>
      <div><input id="graphus-script-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="64-character script hash or bloch1q…" spellCheck={false} autoComplete="off" /><button className="btn" type="submit" disabled={busy}>{busy ? "Loading…" : "Trace"}</button></div>
    </form>
    {error && <p className="data-warning" role="status">{error}{history ? " Showing the previous script snapshot." : ""}</p>}
    {history && <>
      <div className="graphus-script-summary"><strong>{fmtInt(history.total)} recorded events</strong><span>{fmtInt(history.events.length)} shown · indexed as of slot {fmtInt(history.asOfSlot)}</span><code>{short(history.scriptHash)}</code></div>
      <div className="graphus-script-map" role="group" aria-label={`Script reference ${history.scriptHash} with ${history.total} indexed creation or spend events. Each point opens its outpoint. The diagram shows up to twelve returned events without asserting ownership.`}>
        <svg viewBox="0 0 800 360">
          <g className="graphus-map-links">{events.map((_, index) => { const angle = index * Math.PI * 2 / Math.max(events.length, 1) - Math.PI / 2; return <path key={index} d={`M400 180L${400 + Math.cos(angle) * 290} ${180 + Math.sin(angle) * 125}`} />; })}</g>
          <g className="graphus-map-nodes">{events.map((event, index) => { const angle = index * Math.PI * 2 / Math.max(events.length, 1) - Math.PI / 2; const x = 400 + Math.cos(angle) * 290, y = 180 + Math.sin(angle) * 125; return <a key={`${event.kind}-${event.txid}-${event.vout}-${index}`} href={`/outpoint/${event.txid}/${event.vout}`} aria-label={`Open ${event.kind} outpoint ${event.txid}:${event.vout}`}><circle cx={x} cy={y} r="18" /><text x={x} y={y + 5} textAnchor="middle">{event.kind === "created" ? "C" : "S"}</text></a>; })}</g>
          <a href={`/hash/${history.scriptHash}`} aria-label={`Open script reference ${history.scriptHash}`}><circle className="graphus-map-core" cx="400" cy="180" r="37" /><text className="graphus-map-core-label" x="400" y="186" textAnchor="middle">SH</text></a>
        </svg>
        <p>C = output created · S = output spent. Spatial position has no geographic or ownership meaning.</p>
      </div>
      <div className="graphus-recent-head"><div><span className="eyebrow">HOLDER HEAT MAP / WALLET REFERENCES</span><h2>Balance and activity, point by point.</h2></div><span>{sampleBusy || balanceBusy ? "Loading indexed records…" : `${fmtInt(sampled.length)} transactions · ${fmtInt(visibleBalances.length)} balances`}</span></div>
      <p className="lookup-hint">Point area and color show the current indexed balance of each displayed script reference, scaled relative to this sample. Select a point to explore it within Graphus. Lines mean shared transaction presence; they do not prove common ownership or a direct transfer. This is a local sample of up to four receipts and eight neighbors, not a network-wide holder ranking.</p>
      <div className="graphus-holder-stats"><div><span>Balance across displayed references</span><strong>{amount(balanceTotal)}</strong></div><div><span>Largest displayed balance</span><strong>{amount(maxBalance)}</strong></div><div><span>Balance snapshot</span><strong>{balanceHeights.length === 1 ? `H${fmtInt(balanceHeights[0])}` : balanceHeights.length > 1 ? `${balanceHeights.length} indexed heights` : "Unavailable"}</strong></div></div>
      <div className="graphus-wallet-map">
        <svg viewBox="0 0 800 380" role="group" aria-label={`${neighbors.length} script references co-occur with ${history.scriptHash} in ${sampled.length} sampled transactions. Point size and color represent indexed balances relative to the displayed sample. Select a point to explore it.`}>
          <g className="graphus-map-links">{neighbors.map((node, index) => { const angle = index * Math.PI * 2 / neighbors.length - Math.PI / 2; return <path key={node.scriptHash} d={`M400 190L${400 + Math.cos(angle) * 285} ${190 + Math.sin(angle) * 135}`} />; })}</g>
          <g className="graphus-map-nodes">{neighbors.map((node, index) => { const angle = index * Math.PI * 2 / neighbors.length - Math.PI / 2; const x = 400 + Math.cos(angle) * 285, y = 190 + Math.sin(angle) * 135; const radius = balances[node.scriptHash] ? graphusHeat(balances[node.scriptHash].balanceSat, maxBalance).radius : 12; return <a key={node.scriptHash} className={heatClass(node.scriptHash)} href={`/graphus/constellation?script=${node.scriptHash}`} onClick={event => pivot(event, node.scriptHash)} aria-label={`Explore script reference ${node.scriptHash} in Graphus. Indexed balance ${balances[node.scriptHash] ? amount(balances[node.scriptHash].balanceSat) : "unavailable"}.`}><circle className="graphus-heat-halo" cx={x} cy={y} r={radius + 11} /><circle cx={x} cy={y} r={radius} /><text x={x} y={y + 5} textAnchor="middle">{index + 1}</text></a>; })}</g>
          <a className={heatClass(history.scriptHash)} href={`/hash/${history.scriptHash}`} aria-label={`Open selected script reference ${history.scriptHash}. Indexed balance ${balances[history.scriptHash] ? amount(balances[history.scriptHash].balanceSat) : "unavailable"}.`}><circle className="graphus-heat-halo" cx="400" cy="190" r={(balances[history.scriptHash] ? graphusHeat(balances[history.scriptHash].balanceSat, maxBalance).radius : 12) + 11} /><circle className="graphus-map-core" cx="400" cy="190" r={balances[history.scriptHash] ? graphusHeat(balances[history.scriptHash].balanceSat, maxBalance).radius : 12} /><text className="graphus-map-core-label" x="400" y="196" textAnchor="middle">SH</text></a>
        </svg>
        {neighbors.length === 0 && <p>{sampleBusy ? "Reading a bounded transaction sample…" : "No other script references found in the available transaction sample."}</p>}
        <div className="graphus-heat-legend" aria-label="Balance heat scale relative to the displayed sample"><span>0 sat</span><i aria-hidden="true" /><span>{amount(maxBalance)}</span></div>
      </div>
      {neighbors.length > 0 && <div className="graphus-neighbor-list" role="list" aria-label="Script references seen in sampled transactions">{neighbors.map((node, index) => <div role="listitem" key={node.scriptHash}><strong>{index + 1}</strong><a href={`/graphus/constellation?script=${node.scriptHash}`} onClick={event => pivot(event, node.scriptHash)} className="mono-link">Explore {short(node.scriptHash)} →</a><span>{balances[node.scriptHash] ? `${amount(balances[node.scriptHash].balanceSat)} held · ${fmtInt(balances[node.scriptHash].utxoCount)} UTXOs` : balanceBusy ? "Loading balance…" : "Balance unavailable"}</span><small>{node.transactions} shared {node.transactions === 1 ? "transaction" : "transactions"} · {node.inputCount} inputs / {node.outputCount} outputs</small><div className="graphus-neighbor-links"><Link to={`/hash/${node.scriptHash}`}>Full script record ↗</Link><Link to={`/tx/${node.txids[0]}`}>Example transaction ↗</Link></div></div>)}</div>}
      <div className="graphus-event-list" role="list" aria-label="Indexed events for this script hash">{history.events.map((event, index) => <div role="listitem" key={`${event.kind}-${event.txid}-${event.vout}-${index}`}><strong>{event.kind === "created" ? "CREATED" : "SPENT"}</strong><span>{amount(event.valueSat)} · H{fmtInt(event.height)} / S{fmtInt(event.slot)}</span><Link to={`/outpoint/${event.txid}/${event.vout}`}>{short(event.txid)}:{event.vout} ↗</Link>{event.transactionId && event.transactionId !== event.txid && <Link to={`/tx/${event.transactionId}`}>Spending transaction ↗</Link>}</div>)}</div>
      {history.total > history.events.length && <p className="lookup-hint">Showing the first {fmtInt(history.events.length)} events from a snapshot with {fmtInt(history.total)}. The complete history remains available through the indexer API.</p>}
      <p className="lookup-hint">Source: {history.source}{history.verification ? ` · ${history.verification}` : ""}. No private Graphus research records or scores are served here.</p>
    </>}
  </section>;
}

export function GraphusConstellationPage() {
  const [page, setPage] = useState<GraphusPage | null>(null);
  const [selected, setSelected] = useState<GraphusTransaction | null>(null);
  const [selectedFromFeed, setSelectedFromFeed] = useState(true);
  const [focus, setFocus] = useState<Focus>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [matches, setMatches] = useState<GraphusTransaction[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [scriptTarget, setScriptTarget] = useState<string | null>(() => new URLSearchParams(window.location.search).get("script"));
  useEffect(() => {
    let active = true;
    const stop = pollWhileVisible(async () => {
      try {
        const result = graphusPage(await indexedTransactions(undefined, 4));
        if (!result) throw new Error("The historical index returned an invalid page.");
        if (active) {
          setPage(result); setError(null);
          setSelected(previous => previous ?? result.transactions[0] ?? null);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "The historical index is unavailable.");
      }
    }, 60_000);
    return () => { active = false; stop(); };
  }, []);
  const lookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const txid = query.trim();
    setLookupError(null); setMatches([]);
    if (!/^[0-9a-f]{64}$/i.test(txid)) { setLookupError("Enter a 64-character hexadecimal transaction ID."); return; }
    setLookingUp(true);
    try {
      const result = await indexedTransaction(txid);
      const record = graphusTransaction(result);
      if (!record) { setLookupError(result === null ? "This ID is not in the current indexer snapshot." : "The indexer returned an invalid receipt."); return; }
      setSelected(record); setSelectedFromFeed(false); setFocus(null);
    } catch (cause) {
      if (cause instanceof IndexedTxAmbiguity) {
        const choices = cause.matches.map(graphusTransaction).filter((record): record is GraphusTransaction => record !== null);
        setMatches(choices);
        setLookupError("This ID appears in more than one indexed block. Choose an occurrence below.");
      } else setLookupError(cause instanceof Error ? cause.message : "Unable to look up this transaction.");
    } finally { setLookingUp(false); }
  };
  const choose = (record: GraphusTransaction, fromFeed: boolean) => { setSelected(record); setSelectedFromFeed(fromFeed); setFocus(null); setLookupError(null); setMatches([]); };
  const trace = (scriptHash: string) => { setScriptTarget(scriptHash); window.requestAnimationFrame(() => document.getElementById("graphus-script")?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const selectedInPage = selectedFromFeed && page?.transactions.some(record =>
    record.txid === selected?.txid && record.blockId === selected?.blockId);
  return <div className="container graphus-page">
    <div className="overview-heading"><div><span className="eyebrow">BLOCH GRAPHUS / GENESIS-4</span><h1>Bloch constellation.</h1><p>Graphus Oculum ranks the largest indexed wallet references. Inspect transaction structure and local relationships below.</p></div><a href="#oculum-map">Explore Oculum ↓</a></div>
    <div className="graphus-page-boundary" role="status">This is a factual eUTXO view. It does not infer wallet owners, direct input-to-output value paths, risk, or AML scores. Graphus's separate public research preview has no live transaction API.</div>
    <HolderOculum />
    <form className="graphus-lookup" onSubmit={event => void lookup(event)}>
      <label htmlFor="graphus-txid">Find an indexed Bloch transaction</label>
      <div><input id="graphus-txid" value={query} onChange={event => setQuery(event.target.value)} placeholder="64-character transaction ID" spellCheck={false} autoComplete="off" /><button className="btn" type="submit" disabled={lookingUp}>{lookingUp ? "Looking up…" : "Inspect"}</button></div>
    </form>
    {lookupError && <p className="data-warning" role="status">{lookupError}</p>}
    {matches.length > 0 && <div className="graphus-recent" aria-label="Matching transaction occurrences">{matches.map(record => <button key={`${record.blockId}-${record.txid}`} type="button" onClick={() => choose(record, false)}>H{fmtInt(record.height)} · S{fmtInt(record.slot)} · {short(record.blockId)}</button>)}</div>}
    <div className="graphus-recent-head"><h2>Latest indexed transactions</h2><span>{page ? `Snapshot S${fmtInt(page.asOfSlot)} · ${page.source}` : "Waiting for indexer"}</span></div>
    {error && <p className="data-warning" role="status">{error}{page ? " Showing the last available snapshot." : ""}</p>}
    <div className="graphus-recent" aria-label="Choose a recent Bloch transaction">
      {page?.transactions.length ? page.transactions.map(record => <button key={`${record.blockId}-${record.txid}`} type="button" className={selectedFromFeed && selected?.txid === record.txid && selected.blockId === record.blockId ? "is-selected" : ""} onClick={() => choose(record, true)}><strong>{short(record.txid)}</strong><span>S{fmtInt(record.slot)} · {record.inputs.length} in / {record.outputs.length} out</span></button>) : <span>{error ?? "Waiting for indexed transactions."}</span>}
    </div>
    {selected && <>
      <div className="graphus-selected-head"><div><span className="eyebrow">INDEXED TRANSACTION / {selected.kind}</span><h2>{short(selected.txid)}</h2><p>Block H{fmtInt(selected.height)} · slot {fmtInt(selected.slot)} · fee {selected.feeSat === null ? "unavailable" : amount(selected.feeSat)}</p></div><Link className="btn btn-sm" to={`/tx/${selected.txid}`}>Full receipt ↗</Link></div>
      <Graph tx={selected} />
      <div className="graphus-inspector">
        <IoList tx={selected} side="input" focus={focus} onFocus={setFocus} />
        <IoList tx={selected} side="output" focus={focus} onFocus={setFocus} />
        <Evidence tx={selected} focus={focus} asOfSlot={selectedInPage ? page?.asOfSlot ?? null : null} source={selectedInPage ? page?.source ?? null : null} verification={selectedInPage ? page?.verification ?? null : null} onTrace={trace} />
      </div>
    </>}
    <ScriptConstellation initialScript={scriptTarget ?? selected?.outputs[0]?.scriptHash ?? selected?.inputs[0]?.scriptHash ?? null} />
  </div>;
}
