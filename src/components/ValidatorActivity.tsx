// SPDX-License-Identifier: AGPL-3.0-or-later
// A bounded, attributable record. Empty slots cannot be assigned to a validator.
import { SlotWindow } from "../lib/participation";
import { fmtInt, timeAgo } from "../lib/format";
import { Link } from "../lib/router";
import "./validatorActivity.css";

export function ValidatorActivity({ win, index }: { win: SlotWindow; index: number }) {
  const groups = new Map<number, typeof win.slots>();
  for (const slot of win.slots) {
    const epoch = slot.epoch ?? Math.floor(slot.slot / win.head.slots_per_epoch);
    groups.set(epoch, [...(groups.get(epoch) ?? []), slot]);
  }
  const epochs = [...groups.entries()].sort((a, b) => b[0] - a[0]);
  const own = win.slots.filter((slot) => slot.present && slot.proposer_index === index);
  const latest = own[0];

  return (
    <div className="validator-activity">
      <div className="validator-activity-head">
        <div>
          <span className="g4-k">Latest observed proposal</span>
          <strong>{latest ? <Link to={`/slot/${latest.slot}`}>slot {fmtInt(latest.slot)}</Link> : "None in this window"}</strong>
          <span className="g4-dim">{latest?.timestamp ? timeAgo(latest.timestamp) : `Across slots ${fmtInt(win.from)}–${fmtInt(win.to)}`}</span>
        </div>
        <p>Each cell is one queried slot. A highlighted cell names this validator as the block proposer; an empty slot has no attributable proposer.</p>
      </div>
      <div className="validator-epochs">
        {epochs.map(([epoch, slots]) => {
          const proposals = slots.filter((s) => s.present && s.proposer_index === index).length;
          const unread = slots.filter((s) => !!s.unreadable).length;
          return (
            <div className="validator-epoch" key={epoch}>
              <div className="validator-epoch-label">
                <strong>Epoch {fmtInt(epoch)}</strong>
                <span>{fmtInt(proposals)} proposed · {fmtInt(slots.length)} queried{unread ? ` · ${fmtInt(unread)} unread` : ""}</span>
              </div>
              <div className="validator-epoch-slots" aria-label={`Epoch ${epoch}: ${proposals} observed proposals in ${slots.length} queried slots`}>
                {[...slots].reverse().map((s) => {
                  const mine = s.present && s.proposer_index === index;
                  const kind = s.unreadable ? "unread" : mine ? "own" : s.present ? "other" : "empty";
                  const label = s.unreadable ? "unreadable" : mine ? "proposed by this validator" : s.present ? `proposed by validator ${s.proposer_index ?? "unknown"}` : "no block";
                  return <Link className={`validator-slot validator-slot-${kind}`} key={s.slot} to={`/slot/${s.slot}`} title={`Slot ${fmtInt(s.slot)}: ${label}`} aria-label={`Slot ${fmtInt(s.slot)}: ${label}`}><span className="validator-slot-text">Slot {fmtInt(s.slot)}: {label}</span></Link>;
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="validator-activity-legend" aria-label="Slot legend">
        <span><i className="validator-slot-own" /> This validator</span>
        <span><i className="validator-slot-other" /> Other proposer</span>
        <span><i className="validator-slot-empty" /> No block</span>
        <span><i className="validator-slot-unread" /> Unread</span>
      </div>
    </div>
  );
}
