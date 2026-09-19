// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Live Genesis-4 head.
//
// Compact Genesis-4 head card retained for the historical dashboard module.
// It deliberately shares the current explorer's transport and polling rules,
// so reusing that module cannot silently restore the old direct gateway path.
//
import { useEffect, useState } from "react";
import { fmtInt } from "../lib/format";
import { g4rpc, G4Head, pollWhileVisible } from "../lib/g4";

const POLL_MS = 15_000;

export function Genesis4Card() {
  const [head, setHead] = useState<G4Head | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let inFlight = false;
    const ac = new AbortController();
    const tick = async () => {
      if (stop || inFlight) return;
      inFlight = true;
      try {
        // Use the same bounded archival-first transport as the rest of the
        // explorer. This legacy card used to bypass it and poll the wallet's
        // public g4rpc gateway directly, including while the tab was hidden.
        const h = await g4rpc<G4Head>("getchaininfo", [], { signal: ac.signal });
        if (!stop) {
          setHead(h);
          setErr(null);
        }
      } catch (e: any) {
        if (!stop && e?.name !== "AbortError") setErr(String(e?.message ?? e));
      } finally {
        inFlight = false;
      }
    };
    const teardown = pollWhileVisible(tick, POLL_MS);
    return () => {
      stop = true;
      ac.abort();
      teardown();
    };
  }, []);

  // Justification is a separate question from production, and the honest
  // answer is whichever the chain gives — a card that implied finality the
  // chain has not reached would be worse than one that says "none yet".
  const finalised = head ? head.finalized.epoch > 0 || head.finalized_height > 0 : false;

  return (
    <section className="card g4-card">
      <div className="g4-head">
        <div>
          <span className="g4-badge">Genesis-4 · live</span>
          <h2 className="g4-title">Proof of stake</h2>
        </div>
        <div className="g4-sub">
          64 genesis validators · 30 s slots · {head ? head.slots_per_epoch : 32}-slot epochs
        </div>
      </div>

      {err && !head ? (
        <p className="g4-note">
          The Genesis-4 endpoint did not answer ({err}). The chain may still be producing — this
          card reports the proxy, not the network.
        </p>
      ) : !head ? (
        <p className="g4-note">Reading the head…</p>
      ) : (
        <>
          <div className="g4-grid">
            <div className="g4-stat">
              <span className="g4-k">Slot</span>
              <span className="g4-v">{fmtInt(head.slot)}</span>
            </div>
            <div className="g4-stat">
              <span className="g4-k">Height</span>
              <span className="g4-v">{fmtInt(head.height)}</span>
            </div>
            <div className="g4-stat">
              <span className="g4-k">Epoch</span>
              <span className="g4-v">
                {fmtInt(head.epoch)}
                <span className="g4-dim">
                  {" "}
                  · slot {head.slot_in_epoch}/{head.slots_per_epoch}
                </span>
              </span>
            </div>
            <div className="g4-stat">
              <span className="g4-k">Finalized</span>
              <span className="g4-v">
                {finalised ? `epoch ${fmtInt(head.finalized.epoch)}` : "none yet"}
              </span>
            </div>
          </div>
          <div className="g4-roots">
            <span>
              head <code>{head.block_id.slice(0, 16)}</code>
            </span>
            <span>
              state <code>{head.state_root.slice(0, 16)}</code>
            </span>
          </div>
        </>
      )}

      <p className="g4-note">
        Genesis-4 opens with the Genesis-3 balances carried over — 452,726 outputs,
        18,146,400,000 BLOCH — plus the genesis allocations, for 57,146,400,000 BLOCH issued at
        height 0. Blocks are produced by the 64 genesis validators; the declining genesis-cohort cap
        lowers their share to a third over the first year.
      </p>
    </section>
  );
}
