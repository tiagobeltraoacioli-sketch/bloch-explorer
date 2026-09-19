// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Blocks, by slot.
//
// A page of slots rather than a page of blocks, and that is the substantive
// choice here. Every explorer anyone has used lists *blocks*, consecutively,
// because on a proof-of-work chain a block is produced for every step of the
// chain and the two lists are the same list. Under proof of stake they are
// not: a slot is a scheduled opportunity, and on this chain 38.3% of those
// opportunities produced nothing — 20,895 empty slots out of 54,585 at the
// time of writing.
//
// Listing only the blocks would hide every one of those. The misses are not
// noise; they are the single clearest picture of the network's health this
// explorer can show, and there is a stretch of roughly 15,000 consecutive
// slots (about slots 18,500–33,500) where the chain barely produced at all. A
// block-only list renders that catastrophe as an unremarkable run of blocks.
// So the unit of this page is the slot, and an empty one gets a row.

import { useCallback, useEffect, useRef, useState } from "react";
import { SlotCell, slotRange, clearSlotCache, headAgreement, Agreement } from "../lib/source";
import { G4Head } from "../lib/g4";
import { SlotTable, SlotTally } from "../components/blockstream";
import { fmtInt } from "../lib/format";
import { Link, useRouter } from "../lib/router";
import { Loading } from "../components/ui";
import { epochOf } from "../lib/query";
import { SlotStrip, StripLegend } from "../components/kit";
import { windowStats } from "../lib/slots";
import { fmtNum } from "../lib/format";

/**
 * Slots per page.
 *
 * One epoch's worth, so a page boundary is a meaningful boundary rather than
 * an arbitrary one — finality moves at epoch granularity, and a reader
 * checking "did this epoch finalize" wants its slots together. It is also
 * about as many cold historical lookups (1–3 s each, six at a time) as is
 * decent to ask of the archivals for one screen.
 */
const PAGE = 32;

export function G4BlocksPage({ from }: { from?: number }) {
  const { navigate } = useRouter();
  const [head, setHead] = useState<G4Head | null>(null);
  const [headState, setHeadState] = useState<Agreement<G4Head> | null>(null);
  const [cells, setCells] = useState<SlotCell[] | null>(null);
  const [loadedTop, setLoadedTop] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jump, setJump] = useState("");
  const [futureRequest, setFutureRequest] = useState<number | null>(null);
  const request = useRef(0);

  // Where the page starts. Explicit in the URL when the reader navigated to a
  // range; otherwise the head, resolved once.
  const [top, setTop] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    ++request.current;
    setTop(null);
    setLoadedTop(null);
    setCells(null);
    setHead(null);
    setHeadState(null);
    setErr(null);
    setBusy(false);
    setFutureRequest(null);
    headAgreement().then((a) => {
      if (stop) return;
      setHeadState(a);
      const h = a.kind === "agree" ? a.value : a.kind === "single" ? a.value : a.kind === "disagree" ? a.a : null;
      if (h) {
        setHead(h);
        // Resolve the head before reading an explicit range. The node's
        // SLOT_EMPTY response cannot distinguish a future slot from a missed
        // past proposal, so querying beyond the head would invent misses.
        if (from !== undefined && from > h.slot) setFutureRequest(from);
        setTop(Math.min(from ?? h.slot, h.slot));
      } else {
        setErr("No archival answered.");
      }
    }).catch((e) => !stop && setErr(String((e as Error)?.message ?? e)));
    return () => {
      stop = true;
    };
  }, [from]);

  const load = useCallback(
    (topSlot: number) => {
      const token = ++request.current;
      const ac = new AbortController();
      setBusy(true);
      setErr(null);
      slotRange(Math.max(0, topSlot - PAGE + 1), topSlot, ac.signal)
        .then((cs) => {
          if (token !== request.current) return;
          setCells(cs);
          setLoadedTop(topSlot);
          setBusy(false);
        })
        .catch((e) => {
          if (token !== request.current) return;
          setErr(String(e?.message ?? e));
          setBusy(false);
        });
      return () => ac.abort();
    },
    [],
  );

  useEffect(() => {
    if (top === null) return;
    setJump(String(top));
    return load(top);
  }, [top, load]);

  const goto = (t: number) => {
    setFutureRequest(head && t > head.slot ? t : null);
    const clamped = Math.min(head?.slot ?? t, Math.max(PAGE - 1, t));
    setTop(clamped);
    navigate(`/blocks/${clamped}`);
  };

  const readyCells = loadedTop === top ? cells : null;

  if (err && !readyCells) {
    return (
      <div className="container">
        <h1 className="page-title">Blocks</h1>
        <div className="errbox">{err}</div>
      </div>
    );
  }
  if (top === null || !readyCells) return <Loading label="Reading slots…" />;

  const bottom = Math.max(0, top - PAGE + 1);
  const atHead = head !== null && top >= head.slot;
  const asc = [...readyCells].sort((a, b) => a.slot - b.slot);
  const st = windowStats(asc);

  return (
    <div className="container">
      <h1 className="page-title">Blocks, by slot</h1>
      <p className="page-lede">
        Slots {fmtInt(bottom)}–{fmtInt(top)}, newest first — epoch{" "}
        <Link to={`/epoch/${epochOf(bottom)}`}>{fmtInt(epochOf(bottom))}</Link>
        {epochOf(bottom) !== epochOf(top) ? <>–<Link to={`/epoch/${epochOf(top)}`}>{fmtInt(epochOf(top))}</Link></> : ""}. Every slot gets a
        row, including the ones that produced nothing: a slot is a scheduled
        opportunity to propose, and on this chain about{" "}
        {head ? ((1 - head.height / Math.max(1, head.slot)) * 100).toFixed(1) : "38"}% of them
        have gone unused. Height and slot are different numbers and diverge by exactly that
        much — there is no lookup by height on this chain, so if you have one,{" "}
        <Link to="/">use the search box</Link>, which searches for it.
      </p>

      {headState?.kind === "disagree" && (
        <div className="errbox warn">
          <strong>The two archivals disagree about the finalized checkpoint.</strong> One reports
          epoch {fmtInt(headState.a.finalized.epoch)} at root{" "}
          <code>{headState.a.finalized.root.slice(0, 16)}</code>, the other epoch{" "}
          {fmtInt(headState.b.finalized.epoch)} at root{" "}
          <code>{headState.b.finalized.root.slice(0, 16)}</code>. Published guidance is to treat
          disagreement as a hold condition, not a retry — nothing on this page should be read as
          settled while it stands.
        </div>
      )}
      {headState?.kind === "single" && (
        <div className="errbox warn">
          <strong>Nothing here has been cross-checked</strong> — {headState.why || "only one archival answered"}.
          Two independent nodes agreeing on root <em>and</em> epoch is the published bar for
          treating a finality reading as durable, and it has not been met for this page.
        </div>
      )}
      {futureRequest !== null && head && <div className="data-warning" role="status">Slot {fmtInt(futureRequest)} is ahead of the observed head at {fmtInt(head.slot)}. The node's empty response cannot prove that a future proposal was missed, so this page opened the head range instead of querying it.</div>}
      {err && readyCells && <div className="errbox warn" role="alert"><strong>The re-read failed.</strong> {err} The range below is the previous complete reading for these same slots.</div>}

      <div className="card">
        <div className="range-bar">
          <button className="pill-tab" onClick={() => goto(top + PAGE)} disabled={busy || atHead}>
            ← newer
          </button>
          <button
            className="pill-tab"
            onClick={() => head && goto(head.slot)}
            disabled={busy || !head || atHead}
          >
            head
          </button>
          <span className="range-label">
            slot {fmtInt(bottom)} – {fmtInt(top)}
          </span>
          <button className="pill-tab" onClick={() => goto(top - PAGE)} disabled={busy || bottom <= 0}>
            older →
          </button>
          <button
            className="pill-tab go"
            onClick={() => {
              clearSlotCache();
              load(top);
            }}
            disabled={busy}
            title="Discard cached slot readings and read them again. Finality verdicts change; cached ones go stale."
          >
            {busy ? "…" : "re-read"}
          </button>
        </div>

        <SlotStrip cells={asc} current={head?.slot} />
        <div className="strip-axis">
          <span>slot {fmtInt(bottom)}</span>
          <span>slot {fmtInt(top)}{atHead ? " · head" : ""}</span>
        </div>
        <StripLegend />
        <div className="stats" style={{ margin: "14px 0" }}>
          <div className="stat">
            <span className="label">Fill rate</span>
            <span className="value">{st.fillRate === null ? "—" : `${fmtNum(st.fillRate * 100, 0)}%`}</span>
            <span className="sub">{fmtInt(st.blocks)} blocks · {fmtInt(st.empty)} missed{st.unknown ? ` · ${fmtInt(st.unknown)} unread` : ""}</span>
          </div>
          <div className="stat">
            <span className="label">Transactions</span>
            <span className="value">{fmtInt(st.txs)}</span>
            <span className="sub">carried in {fmtInt(st.blocks)} readable blocks{st.unknown ? ` · partial, ${fmtInt(st.unknown)} slots unread` : ""}</span>
          </div>
          <div className="stat">
            <span className="label">Attestations</span>
            <span className="value">{st.meanAttestations === null ? "—" : fmtNum(st.meanAttestations, 2)}</span>
            <span className="sub">mean per readable block · {fmtInt(st.votes)} observed{st.unknown ? " · partial" : ""}</span>
          </div>
          <div className="stat">
            <span className="label">Proposers</span>
            <span className="value">{fmtInt(st.distinctProposers)}</span>
            <span className="sub">distinct validators</span>
          </div>
          <div className="stat">
            <span className="label">Block interval</span>
            <span className="value">{st.meanIntervalSecs === null ? "—" : `${fmtNum(st.meanIntervalSecs, 0)}s`}</span>
            <span className="sub">mean between observed blocks{st.unknown ? " · unread gaps may distort it" : ""}</span>
          </div>
          <div className="stat">
            <span className="label">Read coverage</span>
            <span className="value">{fmtInt(st.blocks + st.empty)} / {fmtInt(st.slots)}</span>
            <span className="sub">answered slots · unread is never counted as missed</span>
          </div>
        </div>
        <SlotTable cells={readyCells} />
        <SlotTally cells={readyCells} />
      </div>

      <form className="lookup-hint" style={{ marginTop: 14 }} onSubmit={(event) => {
        event.preventDefault();
        const value = Number(jump);
        if (Number.isSafeInteger(value) && value >= 0) goto(value);
      }}>
        <label htmlFor="slot-range-jump">Jump to a slot: </label>
        <input
          id="slot-range-jump"
          className="slot-jump"
          type="number"
          min={0}
          max={head?.slot}
          value={jump}
          onChange={(event) => setJump(event.target.value)}
          aria-describedby="slot-jump-hint"
        />{" "}
        <button className="pill-tab" type="submit" disabled={busy || !jump}>Open range</button>
        <span id="slot-jump-hint"> {head ? `The current observed head is slot ${fmtInt(head.slot)}; future slots are clamped to it.` : "The latest readable slot is still being established."}</span>
      </form>
    </div>
  );
}
