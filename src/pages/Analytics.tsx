// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Chain analytics — what can be measured about Genesis-4 from what it serves.
//
// Two kinds of number live here and the page keeps them apart:
//
//   LIFETIME figures are arithmetic over the head and the consensus constants:
//   the chain's age, how many of its slots ever carried a block, what the
//   emission curve has paid out by now. They cost one `getchaininfo`.
//
//   WINDOW figures are folded from block headers over a bounded run of recent
//   epochs — proposers, attestations, intervals, transactions. Each epoch is
//   thirty-two slot reads through the edge, which caches a finalised slot for
//   a week, so the first reader of an epoch pays and everyone after them does
//   not. The page still loads epochs in sequence and asks for four at a time,
//   because the first reader is real.
//
// And the thing this page does NOT compute, in the same spirit as the finality
// page: a participation rate. Attestations included is a count against the
// active-set size for scale, never a percentage of validators who voted.
import { useEffect, useMemo, useRef, useState } from "react";
import { g4rpc, G4, G4Head, G4Error } from "../lib/g4";
import { EpochSummary, loadEpoch, tierOf, intervalBuckets, epochStartMs } from "../lib/epochs";
import { Kpi, SlotStrip, StripLegend, ProposerBars, TierPill } from "../components/kit";
import { ChartCard, BarChart } from "../components/charts";
import { Loading } from "../components/ui";
import { Link } from "../lib/router";
import { fmtBloch, fmtCompactBloch, fmtInt, fmtNum, timeAgo, fmtTime } from "../lib/format";
import { PARAMS, EPOCH_SECS } from "../lib/g4params";
import {
  G4Supply,
  GENESIS_ISSUED_SAT,
  TOTAL_SUPPLY_SAT,
  VALIDATOR_EMISSION_SAT,
  SLOTS_PER_YEAR,
  EMISSION_YEARS,
  emittedDecayBy,
  rewardDecaySat,
  annualInflationBps,
} from "../lib/supply";
import "../dashboard.css";

/** Epochs loaded per request. */
const BATCH = 4;
/** The most this page will hold. Older history is the indexer's job. */
const MAX_EPOCHS = 24;

export function AnalyticsPage() {
  const [head, setHead] = useState<G4Head | null>(null);
  const [supply, setSupply] = useState<G4Supply | null | "absent">(null);
  const [supplyError, setSupplyError] = useState<string | null>(null);
  const [observedAt, setObservedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [epochs, setEpochs] = useState<Map<number, EpochSummary>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const lowest = useRef<number | null>(null);
  const ac = useRef<AbortController | null>(null);

  useEffect(() => {
    let stop = false;
    ac.current = new AbortController();
    (async () => {
      try {
        const h = await g4rpc<G4Head>("getchaininfo", [], { signal: ac.current!.signal });
        if (stop) return;
        setHead(h);
        setObservedAt(Date.now());
        try {
          const s = await g4rpc<G4Supply>("getsupply", [], { signal: ac.current!.signal });
          if (!stop) setSupply(s);
        } catch (e) {
          if (!stop) {
            setSupply(e instanceof G4Error && e.code === -32601 ? "absent" : null);
            setSupplyError(e instanceof Error ? e.message : "Supply counter unavailable");
          }
        }
        await loadBatch(h, h.epoch, BATCH);
      } catch (e: any) {
        if (!stop && e?.name !== "AbortError") setErr(String(e?.message ?? e));
      }
    })();
    return () => {
      stop = true;
      ac.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Load `n` epochs downward from `from`, one at a time, painting as they fill. */
  async function loadBatch(h: G4Head, from: number, n: number) {
    setBusy(true);
    setErr(null);
    try {
      for (let e = from; e > from - n && e >= 0; e--) {
        if (ac.current?.signal.aborted) return;
        const put = (s: EpochSummary) =>
          setEpochs((prev) => {
            const next = new Map(prev);
            next.set(s.epoch, s);
            return next;
          });
        const s = await loadEpoch(e, h.slot, { signal: ac.current?.signal, onProgress: put });
        put(s);
        lowest.current = lowest.current === null ? e : Math.min(lowest.current, e);
      }
    } catch (e) {
      if (!ac.current?.signal.aborted) setErr(e instanceof Error ? e.message : "Epoch history unavailable");
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => [...epochs.values()].sort((a, b) => b.epoch - a.epoch), [epochs]);
  // Window figures fold only CLOSED epochs that were fully read; a partial
  // epoch produces a smaller number that looks like worse production for a
  // reason that has nothing to do with the network.
  const closed = useMemo(() => rows.filter((r) => r.complete), [rows]);
  const window = useMemo(() => {
    const proposers = new Map<number, number>();
    let blocks = 0, missed = 0, unread = 0, votes = 0, txs = 0;
    const intervals: number[] = [];
    for (const r of closed) {
      blocks += r.blocks;
      missed += r.empty;
      unread += r.unknown;
      votes += r.votes;
      txs += r.txs;
      intervals.push(...r.intervals);
      for (const [k, v] of r.proposers) proposers.set(k, (proposers.get(k) ?? 0) + v);
    }
    return { proposers, blocks, missed, unread, votes, txs, intervals, epochs: closed.length };
  }, [closed]);

  if (err && !head) {
    return (
      <div className="container">
        <h1 className="page-title">Analytics</h1>
        <div className="errbox">The Genesis-4 endpoint did not answer ({err}). That reports the proxy, not the network.</div>
      </div>
    );
  }
  if (!head) return <Loading label="Reading the head…" />;

  // ── lifetime ────────────────────────────────────────────────────────────
  const genesisMs = PARAMS.genesisTimeMs.value;
  const ageSecs = (Date.now() - genesisMs) / 1000;
  const slotsElapsed = head.slot + 1;
  const blocksEver = head.height + 1;
  const missedEver = slotsElapsed - blocksEver;
  const fillEver = slotsElapsed > 0 ? blocksEver / slotsElapsed : 0;
  const effectiveBlockSecs = fillEver > 0 ? PARAMS.slotSecs.value / fillEver : null;
  const active = head.validators?.active ?? G4.validators;
  const seatsPerEpoch = active; // one seat per validator per epoch at n = 64

  // ── emission ────────────────────────────────────────────────────────────
  const slotBig = BigInt(head.slot);
  const emittedComputed = emittedDecayBy(slotBig);
  const served = supply && supply !== "absent" ? supply : null;
  const emitted = served ? BigInt(served.emitted_since_genesis_sat) : emittedComputed;
  const issued = served ? BigInt(served.issued_sat) : GENESIS_ISSUED_SAT + emittedComputed;
  const issuedPct = Number((issued * 10_000n) / TOTAL_SUPPLY_SAT) / 100;
  const emittedPct = Number((emitted * 10_000n) / VALIDATOR_EMISSION_SAT) / 100;
  const rewardNow = rewardDecaySat(slotBig);
  const yearNow = slotBig / SLOTS_PER_YEAR;
  const yearPct = Number(((slotBig % SLOTS_PER_YEAR) * 10_000n) / SLOTS_PER_YEAR) / 100;
  const perEpochNow = rewardNow * BigInt(PARAMS.slotsPerEpoch.value);
  const perDayNow = rewardNow * BigInt(Math.round(86_400 / PARAMS.slotSecs.value));
  const diff = served ? BigInt(served.emitted_since_genesis_sat) - emittedComputed : null;

  const oldest = rows.length ? rows[rows.length - 1].epoch : null;
  const canLoad = oldest !== null && oldest > 0 && rows.length < MAX_EPOCHS && !busy;

  return (
    <div className="container">
      <div className="an-head">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-lede" style={{ margin: 0 }}>
            What can be measured about Genesis-4 from what it serves: the chain's lifetime in slots
            and blocks, what the emission curve has paid out, and — over a bounded run of recent
            epochs — who proposed, how many votes reached the chain, and how the slots filled.
          </p>
        </div>
      </div>

      <p className="lookup-hint">Snapshot read {observedAt ? fmtTime(observedAt / 1000) : "—"} · head slot {fmtInt(head.slot)}. Reload this page for a new snapshot.</p>
      {err && <p className="errbox" role="alert">Some epoch history could not be loaded: {err}</p>}
      {/* ── lifetime ─────────────────────────────────────────────────────── */}
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <Kpi k="Chain age" v={fmtNum(ageSecs / 86_400, 1)} unit="days" sub={`since ${G4.genesisTimeUtc}`} />
        <Kpi k="Slots elapsed" v={fmtInt(slotsElapsed)} sub={`${fmtInt(head.epoch)} epochs of ${PARAMS.slotsPerEpoch.value} · ${fmtNum(EPOCH_SECS / 60, 0)} min each`} />
        <Kpi k="Blocks ever" v={fmtInt(blocksEver)} tone="accent" sub={`${fmtNum(fillEver * 100, 1)}% of slots produced one`} />
        <Kpi k="Missed ever" v={fmtInt(missedEver)} sub={`${fmtNum((1 - fillEver) * 100, 1)}% of every slot — no block arrived`} />
        <Kpi k="Effective block time" v={effectiveBlockSecs === null ? "—" : fmtNum(effectiveBlockSecs, 1)} unit="s" sub={`${PARAMS.slotSecs.value} s per slot, stretched by the misses`} />
        <Kpi k="Finalized epochs" v={fmtInt(head.finalized.epoch)} sub={`of ${fmtInt(head.epoch)} · lag ${fmtInt(head.epoch - head.finalized.epoch)} · finalized height ${fmtInt(head.finalized_height)}`} />
      </section>

      {/* ── emission ─────────────────────────────────────────────────────── */}
      <section className="card">
        <h2 className="snap-h2">Emission, on the curve the chain actually runs</h2>
        <div className="an-emission">
          <div>
            <p className="snap-body">
              The transition function calls the smooth-decay curve and nothing else: the validator
              allocation of {fmtBloch(VALIDATOR_EMISSION_SAT, 0)} BLCH is paid out over{" "}
              {Number(EMISSION_YEARS)} years, ten percent less each year than the last. The figures
              below are that arithmetic at the current slot — the same integer truncation the crate
              performs — {served ? "checked against the node's own counter." : "as an estimated ceiling while the supply counter is unavailable."}
            </p>
            <div className="meter" title={`${fmtNum(issuedPct, 2)}% of the hard cap has been issued`}>
              <div className="meter-fill" style={{ width: `${issuedPct}%` }} />
              <div className="meter-mark" style={{ left: `${Number((GENESIS_ISSUED_SAT * 10_000n) / TOTAL_SUPPLY_SAT) / 100}%` }} title="issued at genesis" />
            </div>
            <div className="meter-legend">
              <span>genesis {fmtBloch(GENESIS_ISSUED_SAT, 0)}</span>
              <span>issued {fmtBloch(issued, 0)} · {fmtNum(issuedPct, 2)}%</span>
              <span>cap {fmtBloch(TOTAL_SUPPLY_SAT, 0)}</span>
            </div>
            <p className="lookup-hint">
              {served ? (
                <>
                  <code>getsupply</code> at slot {fmtInt(served.at_slot)} reports{" "}
                  {fmtBloch(BigInt(served.emitted_since_genesis_sat), 0)} BLCH emitted; the curve
                  computes {fmtBloch(emittedComputed, 0)} at slot {fmtInt(head.slot)} —{" "}
                  {diff === 0n ? "they agree to the satoshi." : `a difference of ${fmtBloch(diff! < 0n ? -diff! : diff!, 4)} BLCH. The curve assumes every slot paid its reward; the chain pays only for slots that carried a block, and the two reads need not be from the same slot — so the node's counter is the measurement and the curve is the ceiling.`}
                </>
              ) : (
                <>
                  A computed figure, not a measurement: it assumes every slot paid its reward. Slots
                  that produced no block pay nothing, so the real counter is lower by the misses.
                  The node's <code>getsupply</code> would settle it. {supply === "absent" ? "This node does not support that method." : `The counter could not be read${supplyError ? `: ${supplyError}` : " yet"}.`}
                </>
              )}{" "}
              Nothing here is circulating supply.
            </p>
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <Kpi k="Per block now" v={fmtCompactBloch(rewardNow)} unit="BLCH" title={`${fmtBloch(rewardNow, 8)} BLCH`} sub={`year ${fmtInt(Number(yearNow) + 1)} of ${Number(EMISSION_YEARS)} · ${fmtNum(yearPct, 1)}% through it`} />
            <Kpi k="Per epoch" v={fmtCompactBloch(perEpochNow)} unit="BLCH" title={`${fmtBloch(perEpochNow, 2)} BLCH`} sub="if every slot carries a block" />
            <Kpi k="Per day" v={fmtCompactBloch(perDayNow)} unit="BLCH" title={`${fmtBloch(perDayNow, 2)} BLCH`} sub="ceiling — misses pay nothing" />
            <Kpi k="Inflation" v={`${fmtNum(Number(annualInflationBps(yearNow)) / 100, 2)}%`} sub="of total supply, this year" />
            <Kpi k="Emitted" v={`${fmtNum(emittedPct, 2)}%`} sub="of the validator allocation" />
            <Kpi k="Remaining" v={fmtCompactBloch(TOTAL_SUPPLY_SAT - issued)} unit="BLCH" title={`${fmtBloch(TOTAL_SUPPLY_SAT - issued, 0)} BLCH`} sub="unminted emission budget, not unfound coins" />
          </div>
        </div>
      </section>

      {/* ── epoch history ────────────────────────────────────────────────── */}
      <section className="card">
        <div className="dash-prod-head">
          <h2 className="snap-h2" style={{ margin: 0 }}>Recent epochs</h2>
          <span className="pill quiet pill-sm">{fmtInt(rows.length)} loaded</span>
          {busy && <span className="pill quiet pill-sm"><span className="dot live" /> reading</span>}
          <span className="spacer" />
          <Link to="/blocks" className="pill-tab">slot by slot →</Link>
        </div>
        <div className="table-wrap">
          <table className="tbl an-epochs">
            <thead>
              <tr>
                <th className="num">Epoch</th>
                <th>State</th>
                <th className="epoch-cell">Slots</th>
                <th className="num">Blocks</th>
                <th className="num">Missed</th>
                <th className="num">Unread</th>
                <th className="num">Att.</th>
                <th className="num">Txs</th>
                <th className="num">Proposers</th>
                <th>Began</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.epoch}>
                  <td className="num">
                    <Link to={`/epoch/${r.epoch}`} className="mono-link">{fmtInt(r.epoch)}</Link>
                  </td>
                  <td><TierPill tier={tierOf(r.epoch, head)} /></td>
                  <td>
                    <SlotStrip cells={r.cells} pending={r.pending} variant="mini" />
                  </td>
                  <td className="num">{fmtInt(r.blocks)}<span className="faint">/{PARAMS.slotsPerEpoch.value}</span></td>
                  <td className="num">{fmtInt(r.empty)}</td>
                  <td className="num">{r.unknown ? <span className="pill unknown pill-sm">{fmtInt(r.unknown)}</span> : <span className="faint">0</span>}</td>
                  <td className="num" title={`${fmtInt(r.votes)} attestations included against ${seatsPerEpoch} seats. Not a participation rate.`}>
                    {fmtInt(r.votes)}<span className="faint">/{seatsPerEpoch}</span>
                  </td>
                  <td className="num">{fmtInt(r.txs)}</td>
                  <td className="num">{fmtInt(r.distinctProposers)}</td>
                  <td className="faint" title={fmtTime(epochStartMs(r.epoch) / 1000)}>{timeAgo(epochStartMs(r.epoch) / 1000)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={10}><Loading label="Reading the first epoch…" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <StripLegend pending tx />
        <div className="an-load">
          <button className="btn btn-sm" disabled={!canLoad} onClick={() => oldest !== null && void loadBatch(head, oldest - 1, BATCH)}>
            {busy ? "reading…" : rows.length >= MAX_EPOCHS ? `${MAX_EPOCHS} epochs is the most this page holds` : `load ${BATCH} older epochs`}
          </button>
          <span className="lookup-hint" style={{ margin: 0 }}>
            Each epoch is {PARAMS.slotsPerEpoch.value} slot reads through the edge, which serves a
            finalised slot from cache for a week. History beyond a few hours is the indexer's job,
            not a browser's.
          </span>
        </div>
      </section>

      <section className="card">
        <h2 className="snap-h2">Sample coverage</h2>
        <p>{fmtInt(closed.length)} fully read epochs included out of {fmtInt(rows.length)} loaded. Partial epochs and epochs with unread slots are excluded from the charts and rates.</p>
        {closed.length > 0 && <p className="lookup-hint">Epochs {fmtInt(Math.min(...closed.map(r => r.epoch)))}–{fmtInt(Math.max(...closed.map(r => r.epoch)))} · {fmtInt(closed.length * PARAMS.slotsPerEpoch.value)} sampled slots. Gaps in coverage are excluded; these figures are not network lifetime totals.</p>}
      </section>
      {/* ── the window ───────────────────────────────────────────────────── */}
      {closed.length > 0 && (
        <>
          <div className="grid two-col" style={{ marginBottom: 14 }}>
            <section className="card">
              <h2 className="snap-h2">Who proposed — {fmtInt(window.epochs)} closed {window.epochs === 1 ? "epoch" : "epochs"}</h2>
              <ProposerBars proposers={window.proposers} blocks={window.blocks} limit={16} />
              <p className="lookup-hint">
                {fmtInt(window.proposers.size)} of {fmtInt(active)} validators proposed at least once
                across {fmtInt(window.blocks)} blocks; {fmtInt(Math.max(0, active - window.proposers.size))}{" "}
                proposed nothing in this window. That is a texture, not a liveness verdict: with{" "}
                {fmtInt(active)} validators sharing {fmtInt(window.blocks)} blocks a healthy one is
                expected to propose about {fmtNum(window.blocks / Math.max(1, active), 1)} times, and a
                missed slot cannot be charged to anyone — the node serves no duty roster.
              </p>
            </section>
            <section className="card">
              <h2 className="snap-h2">The window in numbers</h2>
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <Kpi k="Blocks" v={fmtInt(window.blocks)} sub={`of ${fmtInt(window.epochs * PARAMS.slotsPerEpoch.value)} slots`} />
                <Kpi k="Fill rate" v={`${fmtNum((window.blocks / Math.max(1, window.blocks + window.missed)) * 100, 1)}%`} sub={`${fmtInt(window.missed)} missed${window.unread ? ` · ${fmtInt(window.unread)} unread` : ""}`} />
                <Kpi k="Attestations" v={fmtInt(window.votes)} sub={`${fmtNum(window.votes / Math.max(1, window.blocks), 2)} per block · ${Math.floor(active / PARAMS.slotsPerEpoch.value)} seats per slot is full`} />
                <Kpi k="Transactions" v={fmtInt(window.txs)} sub={window.txs === 0 ? "no transactions in the sampled blocks" : `${fmtNum(window.txs / Math.max(1, window.blocks), 2)} per block`} />
              </div>
            </section>
          </div>

          <div className="grid three-col" style={{ marginBottom: 14 }}>
            <ChartCard title="Transactions per epoch" hint="recorded in sampled blocks">
              <BarChart bars={[...closed].reverse().map(r => ({ label: String(r.epoch), value: r.txs }))} yFormat={v => fmtInt(v)} />
            </ChartCard>
            <ChartCard title="Slot fill rate" hint="fully read epochs only · %">
              <BarChart bars={[...closed].reverse().map(r => ({ label: String(r.epoch), value: 100 * r.blocks / PARAMS.slotsPerEpoch.value, color: "var(--chart-4)" }))} yFormat={v => `${fmtNum(v, 1)}%`} />
            </ChartCard>
            <ChartCard title="Distinct proposers per epoch" hint="observed proposers, not participation">
              <BarChart bars={[...closed].reverse().map(r => ({ label: String(r.epoch), value: r.distinctProposers, color: "var(--chart-3)" }))} yFormat={v => fmtInt(v)} />
            </ChartCard>
          </div>
          <div className="grid three-col" style={{ marginBottom: 14 }}>
            <ChartCard title="Attestations per epoch" hint={`against ${seatsPerEpoch} seats`}>
              <BarChart
                bars={[...closed].reverse().map((r) => ({ label: String(r.epoch), value: r.votes }))}
                yFormat={(v) => fmtInt(Math.round(v))}
              />
            </ChartCard>
            <ChartCard title="Blocks per epoch" hint={`of ${PARAMS.slotsPerEpoch.value} slots`}>
              <BarChart
                bars={[...closed].reverse().map((r) => ({ label: String(r.epoch), value: r.blocks, color: "var(--chart-4)" }))}
                yFormat={(v) => fmtInt(Math.round(v))}
              />
            </ChartCard>
            <ChartCard title="Block intervals" hint={`${fmtInt(window.intervals.length)} within-epoch gaps`}>
              <BarChart
                bars={intervalBuckets(window.intervals).map((b) => ({ ...b, color: "var(--chart-3)" }))}
                yFormat={(v) => fmtInt(Math.round(v))}
              />
            </ChartCard>
          </div>
        </>
      )}

      <section className="card">
        <h2 className="snap-h2">What these numbers are, and are not</h2>
        <p className="snap-body">
          <strong>Attestations included is not a participation rate.</strong> The transition keys
          votes by (validator, signing root) and never rejects one an earlier block already carried,
          so duplicates are legal; a proposer may carry earlier slots' attestations only inside its
          own epoch, so a missed final proposal deletes cast votes; and consensus counts a
          deduplicated set in stake, at the boundary, which no RPC exposes. The count is a real
          throughput signal and its collapse is real news; it is shown against the seat count for
          scale and never as a percentage of validators who voted.
        </p>
        <p className="snap-body">
          <strong>A missed slot has no owner here.</strong> A block header names its proposer; an
          empty slot names nobody, because the node serves no duty roster. So "proposed" is
          attributable and "missed" is not, and this page never charges a miss to a validator.
        </p>
        <p className="snap-body" style={{ marginBottom: 0 }}>
          <strong>Unread is not missed.</strong> A slot the archivals did not answer for is drawn in
          its own colour and left out of every rate. Counting our own request budget as a liveness
          failure would invent missed proposals out of nothing.{" "}
          <Link to="/finality">The finality page</Link> carries the same rule for the same reason.
        </p>
      </section>
    </div>
  );
}
