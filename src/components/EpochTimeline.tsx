// SPDX-License-Identifier: AGPL-3.0-or-later
// A bounded, navigable view of epoch and slot history. Each historical jump
// reads at most one epoch (32 slots) through the edge's finalized-slot cache.
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { G4Head } from "../lib/g4";
import { EpochSummary, epochSlots, loadEpoch, tierOf } from "../lib/epochs";
import { SlotCell } from "../lib/slots";
import { Link } from "../lib/router";
import { fmtInt, fmtTime, short } from "../lib/format";
import { TierPill } from "./kit";
import "./epoch-timeline.css";

type TimelineCell = SlotCell | { kind: "reading"; slot: number } | { kind: "pending"; slot: number };

function cellLabel(cell: TimelineCell): string {
  if (cell.kind === "reading") return `Slot ${fmtInt(cell.slot)}: reading`;
  if (cell.kind === "pending") return `Slot ${fmtInt(cell.slot)}: head has not reached it`;
  if (cell.kind === "unknown") return `Slot ${fmtInt(cell.slot)}: unread, ${cell.why}`;
  if (cell.kind === "empty") return `Slot ${fmtInt(cell.slot)}: no block`;
  return `Slot ${fmtInt(cell.slot)}: block, ${cell.block.tx_count} transactions, proposer v${cell.block.proposer_index}`;
}

export function EpochTimeline({ head, epochs }: { head: G4Head; epochs: Map<number, EpochSummary> }) {
  const [selectedEpoch, setSelectedEpoch] = useState(head.epoch);
  const [draft, setDraft] = useState(String(head.epoch));
  const [selectedSlot, setSelectedSlot] = useState<number | null>(head.slot);
  const [historical, setHistorical] = useState<EpochSummary | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const summary = historical?.epoch === selectedEpoch ? historical : epochs.get(selectedEpoch);
  const [first, last] = epochSlots(selectedEpoch);
  const cellsBySlot = useMemo(() => new Map(summary?.cells.map((cell) => [cell.slot, cell]) ?? []), [summary]);
  const slots: TimelineCell[] = useMemo(() =>
    Array.from({ length: 32 }, (_, offset) => {
      const slot = first + offset;
      if (slot > head.slot) return { kind: "pending" as const, slot };
      return cellsBySlot.get(slot) ?? { kind: "reading" as const, slot };
    }), [first, head.slot, cellsBySlot]);
  const detail = selectedSlot === null ? null : slots.find((cell) => cell.slot === selectedSlot) ?? null;
  const tier = tierOf(selectedEpoch, head);

  function selectEpoch(epoch: number) {
    if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > head.epoch) return;
    request.current?.abort();
    request.current = null;
    setSelectedEpoch(epoch);
    setDraft(String(epoch));
    setSelectedSlot(Math.min(epochSlots(epoch)[1], head.slot));
    setHistorical(null);
    setError(null);
    setReading(false);
    if (epochs.has(epoch)) return;
    const controller = new AbortController();
    request.current = controller;
    setReading(true);
    void loadEpoch(epoch, head.slot, {
      signal: controller.signal,
      onProgress: (partial) => {
        if (!controller.signal.aborted) setHistorical(partial);
      },
    }).then((result) => {
      if (!controller.signal.aborted) setHistorical(result);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Epoch could not be read");
    }).finally(() => {
      if (!controller.signal.aborted) setReading(false);
    });
  }

  function jump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(draft.trim());
    if (!/^\d+$/.test(draft.trim()) || !Number.isSafeInteger(value) || value > head.epoch) {
      setError(`Enter an epoch from 0 to ${fmtInt(head.epoch)}.`);
      return;
    }
    selectEpoch(value);
  }

  return (
    <section className="card et-shell" aria-labelledby="epoch-timeline-heading">
      <div className="et-heading">
        <div>
          <span className="eyebrow">GENESIS-4 / CHAIN CHRONOLOGY</span>
          <h2 className="snap-h2" id="epoch-timeline-heading">Slot timeline</h2>
          <p className="lookup-hint">Explore one epoch at a time. Select a slot to inspect its block, or jump to any historical epoch.</p>
        </div>
        <TierPill tier={tier} />
      </div>

      <div className="et-controls">
        <button className="pill-tab" type="button" disabled={reading || selectedEpoch === 0} onClick={() => selectEpoch(selectedEpoch - 1)}>← older</button>
        <strong>Epoch {fmtInt(selectedEpoch)}</strong>
        <button className="pill-tab" type="button" disabled={reading || selectedEpoch >= head.epoch} onClick={() => selectEpoch(selectedEpoch + 1)}>newer →</button>
        <button className="pill-tab" type="button" disabled={reading || selectedEpoch === head.epoch} onClick={() => selectEpoch(head.epoch)}>head</button>
        <form onSubmit={jump} className="et-jump">
          <label htmlFor="et-epoch">Jump to epoch</label>
          <input id="et-epoch" type="number" min="0" max={head.epoch} step="1" inputMode="numeric" value={draft} disabled={reading} onChange={(event) => setDraft(event.target.value)} />
          <button className="btn btn-sm" type="submit" disabled={reading}>Go</button>
        </form>
      </div>

      <div className="et-meta"><span>Slots {fmtInt(first)}–{fmtInt(last)}</span><span>{summary ? `${fmtInt(summary.cells.length)}/${fmtInt(Math.min(32, head.slot - first + 1))} reached slots read · ${fmtInt(summary.blocks)} blocks · ${fmtInt(summary.empty)} missed · ${fmtInt(summary.unknown)} unread · ${fmtInt(summary.txs)} transactions` : "Reading slot history"}</span><Link to={`/epoch/${selectedEpoch}`}>Full epoch record →</Link></div>
      {error && <p className="errbox" role="alert">{error}</p>}
      <div className="et-track" role="group" aria-label={`Epoch ${selectedEpoch} slots`}>
        {slots.map((cell) => (
          <button
            key={cell.slot}
            type="button"
            className={`et-slot et-${cell.kind}${cell.kind === "block" && cell.block.tx_count > 0 ? " et-tx" : ""}${selectedSlot === cell.slot ? " et-selected" : ""}`}
            aria-label={cellLabel(cell)}
            aria-pressed={selectedSlot === cell.slot}
            title={cellLabel(cell)}
            onClick={() => setSelectedSlot(cell.slot)}
          >
            <span className="et-slot-n">{cell.slot % 32 + 1}</span>
            <span className="et-slot-mark">{cell.kind === "block" ? cell.block.tx_count > 0 ? "◈" : "▮" : cell.kind === "empty" ? "·" : cell.kind === "unknown" ? "?" : cell.kind === "pending" ? "–" : "…"}</span>
          </button>
        ))}
      </div>
      <div className="et-axis"><span>slot {fmtInt(first)}</span><span>slot {fmtInt(last)}</span></div>
      <div className="et-legend"><span><i className="et-key et-key-block" /> block</span><span><i className="et-key et-key-tx" /> transactions</span><span><i className="et-key et-key-empty" /> missed</span><span><i className="et-key et-key-unknown" /> unread</span><span><i className="et-key et-key-pending" /> not reached</span></div>

      {detail && (
        <div className="et-detail" aria-live="polite">
          <div className="et-detail-title"><div><span className="eyebrow">SELECTED SLOT</span><h3>Slot {fmtInt(detail.slot)}</h3></div><Link to={`/slot/${detail.slot}`} className="pill-tab">Open slot →</Link></div>
          {detail.kind === "block" ? (
            <div className="et-facts">
              <div><span>Block</span><Link to={`/block/${detail.block.block_id}`} className="mono-link">{short(detail.block.block_id, 14, 8)}</Link></div>
              <div><span>Height</span><strong>{detail.block.height === null ? "—" : fmtInt(detail.block.height)}</strong></div>
              <div><span>Proposer</span><Link to={`/validators/${detail.block.proposer_index}`}>v{detail.block.proposer_index}</Link></div>
              <div><span>Transactions</span><strong>{fmtInt(detail.block.tx_count)}</strong></div>
              <div><span>Attestations included</span><strong>{fmtInt(detail.block.attestation_count)}</strong></div>
              <div><span>Block finality</span><strong>{detail.block.finality}</strong></div>
              <div><span>Block time</span><strong>{fmtTime(detail.block.timestamp)}</strong></div>
            </div>
          ) : <p className="et-outcome">{detail.kind === "empty" ? "The node reported no block in this slot. No proposer can be identified from an empty slot." : detail.kind === "unknown" ? `This slot could not be read: ${detail.why}. Its state is unknown, not a missed block.` : detail.kind === "pending" ? "The sampled head has not reached this slot yet." : reading ? "Reading this slot through the edge…" : "This slot has not answered yet."}</p>}
          <p className="lookup-hint">Epoch status is a checkpoint reading at the sampled head, not a permanent guarantee. Open the block for its own finality reading.</p>
        </div>
      )}
    </section>
  );
}
