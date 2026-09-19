// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One epoch: its thirty-two slots, who built them, and what the epoch carried.
//
// An epoch is the unit finality moves at, so it is the natural page for a
// reader asking "did this stretch of the chain go well". The page reads the
// epoch's slots through the edge (cached for a week once finalised), folds
// them with `lib/epochs`, and says which of the three tiers the head currently
// places the epoch on — a reading as of now, never a settled fact.
import { useEffect, useMemo, useState } from "react";
import { g4rpc, G4Head } from "../lib/g4";
import { EpochSummary, loadEpoch, tierOf, epochSlots, epochStartMs } from "../lib/epochs";
import { Kpi, SlotStrip, StripLegend, ProposerBars, TierPill } from "../components/kit";
import { SlotTable } from "../components/blockstream";
import { Loading } from "../components/ui";
import { Link } from "../lib/router";
import { fmtInt, fmtNum, fmtTime, timeAgo, short } from "../lib/format";
import { PARAMS, EPOCH_SECS } from "../lib/g4params";
import "../dashboard.css";

export function EpochPage({ epoch }: { epoch: number }) {
  const [head, setHead] = useState<G4Head | null>(null);
  const [sum, setSum] = useState<EpochSummary | null>(null);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const ac = new AbortController();
    setSum(null);
    setDone(false);
    setErr(null);
    (async () => {
      try {
        const h = await g4rpc<G4Head>("getchaininfo", [], { signal: ac.signal });
        if (stop) return;
        setHead(h);
        if (epoch > h.epoch) {
          setDone(true);
          return;
        }
        const s = await loadEpoch(epoch, h.slot, {
          signal: ac.signal,
          onProgress: (p) => !stop && setSum(p),
        });
        if (!stop) {
          setSum(s);
          setDone(true);
        }
      } catch (e: any) {
        if (!stop && e?.name !== "AbortError") setErr(String(e?.message ?? e));
      }
    })();
    return () => {
      stop = true;
      ac.abort();
    };
  }, [epoch]);

  const [first, last] = epochSlots(epoch);
  const startMs = epochStartMs(epoch);
  const cellsBySlot = useMemo(() => new Map((sum?.cells ?? []).map((c) => [c.slot, c])), [sum]);

  if (err && !head) {
    return (
      <div className="container">
        <h1 className="page-title">Epoch {fmtInt(epoch)}</h1>
        <div className="errbox">The Genesis-4 endpoint did not answer ({err}). That reports the proxy, not the network.</div>
      </div>
    );
  }
  if (!head) return <Loading label={`Reading epoch ${fmtInt(epoch)}…`} />;

  const tier = tierOf(epoch, head);

  if (tier === "future") {
    return (
      <div className="container">
        <h1 className="page-title">Epoch {fmtInt(epoch)} <TierPill tier={tier} /></h1>
        <div className="card">
          <p className="page-lede" style={{ margin: 0 }}>
            The head is in epoch {fmtInt(head.epoch)}. Epoch {fmtInt(epoch)} begins at slot{" "}
            {fmtInt(first)}, on {fmtTime(startMs / 1000)} — in about{" "}
            {fmtNum(((startMs - Date.now()) / 1000) / 3600, 1)} hours if every slot keeps time.
          </p>
          <div className="ep-nav">
            <Link to={`/epoch/${head.epoch}`} className="pill-tab">the current epoch</Link>
            <Link to="/analytics" className="pill-tab">analytics</Link>
          </div>
        </div>
      </div>
    );
  }

  const reachable = Math.min(last, head.slot) - first + 1;
  const read = sum?.cells.length ?? 0;

  return (
    <div className="container">
      <h1 className="page-title">
        Epoch {fmtInt(epoch)} <TierPill tier={tier} />
        {epoch === head.epoch && <span className="pill brass">in progress</span>}
      </h1>
      <p className="page-lede">
        Slots {fmtInt(first)}–{fmtInt(last)}, {fmtNum(EPOCH_SECS / 60, 0)} minutes beginning{" "}
        {fmtTime(startMs / 1000)} ({timeAgo(startMs / 1000)}).{" "}
        {tier === "final"
          ? "The head this page read reports it finalized: two thirds of the consensus stake voted for a checkpoint above it. A reading, not a latch — on this chain a finalized checkpoint can move down."
          : tier === "justified"
            ? "Justified but not finalized: attested by a supermajority, one step short. Reorganisable."
            : epoch === head.epoch
              ? `The head is inside it, at slot ${head.slot_in_epoch + 1} of ${head.slots_per_epoch}. Nothing here is justified yet.`
              : "Not yet justified. Freely reorganisable."}
      </p>

      {sum ? (
        <>
          <section className="kpi-grid" style={{ marginBottom: 14 }}>
            <Kpi k="Blocks" v={fmtInt(sum.blocks)} tone="accent" sub={`of ${fmtInt(reachable)} slots reached${sum.pending ? ` · ${fmtInt(sum.pending)} still to come` : ""}`} />
            <Kpi k="Missed" v={fmtInt(sum.empty)} sub="the chain said: no block" />
            <Kpi k="Unread" v={fmtInt(sum.unknown)} tone={sum.unknown ? "warn" : undefined} sub={sum.unknown ? "not answered — not counted as missed" : read < reachable && !done ? `reading ${fmtInt(read)}/${fmtInt(reachable)}` : "every slot answered"} />
            <Kpi k="Attestations" v={fmtInt(sum.votes)} sub={`${sum.meanAttestations === null ? "—" : fmtNum(sum.meanAttestations, 2)} included per block · not a participation rate`} title="A raw count of votes included in block bodies. The RPC does not expose the duty roster or aggregation bits needed for participation." />
            <Kpi k="Transactions" v={fmtInt(sum.txs)} sub={sum.txs === 0 ? "none this epoch" : "carried across the epoch"} />
            <Kpi k="Proposers" v={fmtInt(sum.distinctProposers)} sub={`distinct validators · mean interval ${sum.meanIntervalSecs === null ? "—" : fmtNum(sum.meanIntervalSecs, 0) + "s"}`} />
          </section>

          <section className="card">
            <div className="dash-prod-head">
              <h2 className="snap-h2" style={{ margin: 0 }}>The {PARAMS.slotsPerEpoch.value} slots</h2>
              <span className="spacer" />
              <Link to={`/blocks/${Math.min(last, head.slot)}`} className="pill-tab">this range, as a table →</Link>
            </div>
            <SlotStrip cells={sum.cells} pending={sum.pending} variant="tall" current={epoch === head.epoch ? head.slot : undefined} />
            <div className="dash-strip-axis">
              <span>slot {fmtInt(first)}</span>
              <span>slot {fmtInt(last)}</span>
            </div>
            <StripLegend pending={sum.pending > 0} />

            <div className="ep-grid" style={{ marginTop: 18 }}>
              {Array.from({ length: PARAMS.slotsPerEpoch.value }, (_, i) => {
                const s = first + i;
                const c = cellsBySlot.get(s);
                if (s > head.slot) {
                  return (
                    <span key={s} className="ep-cell is-pending">
                      <span className="n">slot {fmtInt(s)}</span>
                      <span className="p">—</span>
                      <span className="m">not reached</span>
                    </span>
                  );
                }
                if (!c) {
                  return (
                    <span key={s} className="ep-cell">
                      <span className="n">slot {fmtInt(s)}</span>
                      <span className="p">…</span>
                      <span className="m">reading</span>
                    </span>
                  );
                }
                if (c.kind === "empty") {
                  return (
                    <Link key={s} to={`/slot/${s}`} className="ep-cell is-empty">
                      <span className="n">slot {fmtInt(s)}</span>
                      <span className="p">missed</span>
                      <span className="m">no block</span>
                    </Link>
                  );
                }
                if (c.kind === "unknown") {
                  return (
                    <Link key={s} to={`/slot/${s}`} className="ep-cell is-unknown" title={c.why}>
                      <span className="n">slot {fmtInt(s)}</span>
                      <span className="p">unread</span>
                      <span className="m">not answered</span>
                    </Link>
                  );
                }
                const b = c.block;
                return (
                  <Link key={s} to={`/slot/${s}`} className={"ep-cell is-block" + (b.tx_count > 0 ? " has-tx" : "")} title={`${short(b.block_id, 12, 8)} · ${b.finality}`}>
                    <span className="n">slot {fmtInt(s)}</span>
                    <span className="p">v{b.proposer_index}</span>
                    <span className="m">{b.attestation_count} att · {b.tx_count} tx</span>
                  </Link>
                );
              })}
            </div>
          </section>

          <div className="grid two-col" style={{ marginBottom: 14 }}>
            <section className="card">
              <h2 className="snap-h2">Who proposed</h2>
              <ProposerBars proposers={sum.proposers} blocks={sum.blocks} limit={32} />
            </section>
            <section className="card">
              <h2 className="snap-h2">How to read this epoch</h2>
              <p className="snap-body">
                The attestation figure is the raw number included in block bodies. The RPC exposes
                neither aggregation bits nor the duty roster, so it cannot support a participation
                percentage or identify which validators were expected to vote in each slot.
              </p>
              <p className="snap-body">
                A validator appearing here proposed on its slot. One appearing never either missed
                its slot or was not scheduled to propose this epoch — the node serves no duty
                roster, so a miss cannot be charged to anyone, and the missed slots above have no
                owner on this page.
              </p>
              <p className="snap-body" style={{ marginBottom: 0 }}>
                The tier at the top is the head's reading right now. On this chain a finalized
                checkpoint is not a latch: an epoch shown finalized can be reported justified later.{" "}
                <Link to="/finality">What the guarantee is worth</Link>.
              </p>
            </section>
          </div>

          <section className="card">
            <h2 className="snap-h2">Slot by slot</h2>
            <SlotTable cells={[...sum.cells].reverse()} />
          </section>
        </>
      ) : (
        <Loading label={`Reading ${fmtInt(reachable)} slots…`} />
      )}

      <div className="ep-nav">
        {epoch > 0 && <Link to={`/epoch/${epoch - 1}`} className="pill-tab">← epoch {fmtInt(epoch - 1)}</Link>}
        {epoch < head.epoch && <Link to={`/epoch/${epoch + 1}`} className="pill-tab">epoch {fmtInt(epoch + 1)} →</Link>}
        <Link to="/analytics" className="pill-tab">analytics</Link>
        <Link to="/finality" className="pill-tab">finality</Link>
      </div>
    </div>
  );
}
