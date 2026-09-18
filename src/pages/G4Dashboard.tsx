// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Genesis-4 dashboard — the whole front page.
//
// One rule shapes this file: show what the chain says, and where it says
// nothing, say nothing. A proof-of-stake chain has two separate healths, and
// conflating them hides the interesting failure. Blocks can arrive on every
// slot while finality stalls; that is a real and survivable state, and it must
// be readable at a glance rather than inferred. So production (the slot strip)
// and finality (the checkpoints and the stall grade) are separate instruments
// on this page and neither is allowed to summarise the other.
//
// Every figure here is one of: a `getchaininfo` field, a sibling cheap read
// (`getvalidatorcount`, `getmempoolinfo`, `getstakedistribution`, `getsupply`),
// a block header from the last 32 slots, or integer arithmetic over consensus
// constants cited in `lib/g4params.ts` and `lib/supply.ts`. Where a method is
// not served by the deployed node the tile says so; it never shows a zero.
import { useEffect, useMemo, useState } from "react";
import {
  g4rpc,
  g4rpcWithMeta,
  pollWhileVisible,
  G4,
  G4Head,
  G4Corroboration,
  G4ValidatorCount,
  G4Error,
} from "../lib/g4";
import { CorroborationBadge, CorroborationNote } from "../components/corroboration";
import { SlotCell, slotWindow, windowStats, wallSlot } from "../lib/slots";
import { SlotTable } from "../components/blockstream";
import { Kpi, SlotStrip, StripLegend } from "../components/kit";
import { TxLandings } from "../components/txBits";
import { ChainOverview } from "../components/chainOverview";
import { fmtBloch, fmtCompactBloch, fmtInt, fmtNum, fmtBytes, fmtTime } from "../lib/format";
import { Link } from "../lib/router";
import { Loading, Copyable } from "../components/ui";
import { gradeStall, CONSENSUS } from "../lib/finality";
import { PARAMS } from "../lib/g4params";
import {
  G4Supply,
  GENESIS_ISSUED_SAT,
  TOTAL_SUPPLY_SAT,
  SLOTS_PER_YEAR,
  emittedDecayBy,
  rewardDecaySat,
  annualInflationBps,
} from "../lib/supply";
import { MIN_BASE_FEE_MILLISAT_PER_GAS } from "../lib/fees";
import "../dashboard.css";

/**
 * The two stake totals, from `getstakedistribution`.
 *
 * They are NOT interchangeable and the gap between them is currently a factor
 * of about 2.25. `duty_total_active_stake_sat` is the pre-leak DUTY roster —
 * the number `getvalidatorcount` and `getchaininfo` report. `total_active_stake_sat`
 * is the post-leak CONSENSUS roster, and it is the one every quorum threshold
 * is actually taken against. Telling a reader to take two thirds of the duty
 * total overstates the quorum by that whole factor. The node names them apart
 * for exactly this reason; see `stake_distribution` in
 * crates/bloch-pos-node/src/rpc.rs.
 */
interface StakeTotals {
  epoch: number;
  total_active_stake_sat: string;
  duty_total_active_stake_sat: string;
}

interface Mempool {
  size: number;
  max: number;
  bytes: number;
}

const POLL_MS = 15_000;
/** One epoch of slots on the strip. */
const WINDOW = 32;
/** Newest slots re-read on every tick even when cached: the reorg allowance. */
const REREAD = 4;
/** Rows in the table under the strip. */
const RECENT = 12;

/** A `-32601`: the deployed binary does not have this method. Not a fault. */
function notServed(e: unknown): boolean {
  return e instanceof G4Error && (e.code === -32601 || e.reason === "method_not_allowed");
}

/** A one-second clock, for the parts of the page that move between polls. */
function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function mmss(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function G4Dashboard() {
  const [head, setHead] = useState<G4Head | null>(null);
  const [corro, setCorro] = useState<G4Corroboration | null>(null);
  const [vals, setVals] = useState<G4ValidatorCount | null>(null);
  const [mp, setMp] = useState<Mempool | null>(null);
  const [stake, setStake] = useState<StakeTotals | null | "absent">(null);
  const [supply, setSupply] = useState<G4Supply | null | "absent">(null);
  const [cells, setCells] = useState<Map<number, SlotCell>>(() => new Map());
  const [err, setErr] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const now = useNow();

  useEffect(() => {
    let stop = false;
    let inFlight = false;
    let slotFlight: Promise<unknown> = Promise.resolve();
    const ac = new AbortController();
    const tick = async () => {
      if (inFlight || stop) return;
      inFlight = true;
      try {
        // Through the EDGE (/rpc), never a validator: the node RPC has no auth
        // or rate limiting and is served by the consensus thread itself. The
        // edge caps the calls it will MAKE and returns the corroboration this
        // page renders beside every number.
        const reading = await g4rpcWithMeta<G4Head>("getchaininfo", [], { signal: ac.signal });
        const h = reading.result;
        if (stop) return;
        setHead(h);
        setCorro(reading.corroboration);
        setErr(null);
        setReadAt(Date.now());

        // The strip: one epoch of slots. Finalised slots come from the edge
        // cache (a week) or this browser's (a minute); only the newest few are
        // re-read every tick, because those are the ones whose finality word
        // can still move.
        const lo = Math.max(0, h.slot - WINDOW + 1);
        slotFlight = slotWindow(lo, h.slot, {
          signal: ac.signal,
          fresh: (s) => s > h.slot - REREAD,
          onCell: (c) => {
            if (stop) return;
            setCells((prev) => {
              const next = new Map(prev);
              next.set(c.slot, c);
              for (const k of next.keys()) if (k < lo) next.delete(k);
              return next;
            });
          },
        });

        // Each of these is allowed to fail on its own. The RPC is served by
        // the consensus loop, so a slow answer during block production is
        // ordinary — one timeout must not blank the page.
        const [v, m, sd, sp] = await Promise.allSettled([
          g4rpc<G4ValidatorCount>("getvalidatorcount", [], { signal: ac.signal }),
          g4rpc<Mempool>("getmempoolinfo", [], { signal: ac.signal }),
          g4rpc<StakeTotals>("getstakedistribution", [], { signal: ac.signal }),
          g4rpc<G4Supply>("getsupply", [], { signal: ac.signal }),
        ]);
        if (stop) return;
        if (v.status === "fulfilled") setVals(v.value);
        setMp(m.status === "fulfilled" ? m.value : null);
        if (sd.status === "fulfilled") setStake(sd.value);
        else if (notServed(sd.reason)) setStake("absent");
        if (sp.status === "fulfilled") setSupply(sp.value);
        else if (notServed(sp.reason)) setSupply("absent");
      } catch (e: any) {
        if (!stop && e?.name !== "AbortError") setErr(String(e?.message ?? e));
      } finally {
        await slotFlight.catch(() => {});
        inFlight = false;
      }
    };
    const teardown = pollWhileVisible(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      ac.abort();
      teardown();
    };
  }, []);

  const ordered = useMemo(() => [...cells.values()].sort((a, b) => a.slot - b.slot), [cells]);
  const stats = useMemo(() => windowStats(ordered), [ordered]);

  if (err && !head) {
    return (
      <div className="container">
        <div className="errbox">
          The Genesis-4 endpoint did not answer ({err}). This reports the proxy, not the network —
          the chain may well still be producing.
        </div>
      </div>
    );
  }
  if (!head) return <Loading label="Reading the head from both archivals…" />;

  // ── derived, from the head and the constants ─────────────────────────────
  const stall = gradeStall(head);
  const lag = head.epoch - head.finalized.epoch;
  const finalised = head.finalized.epoch > 0 || head.finalized_height > 0;
  const genesisMs = PARAMS.genesisTimeMs.value;
  const slotMs = PARAMS.slotSecs.value * 1000;
  const wall = wallSlot(now);
  const intoSlot = ((now - genesisMs) % slotMs) / 1000;
  const slotsLeft = head.slots_per_epoch - (wall % head.slots_per_epoch);
  const secsToEpoch = slotsLeft * PARAMS.slotSecs.value - intoSlot;
  const nodeLag = head.behind_by_slots ?? Math.max(0, wall - head.slot);
  const ageDays = (now - genesisMs) / 86_400_000;
  const lifetimeFill = head.slot > 0 ? head.height / head.slot : null;
  const epochPct = ((head.slot_in_epoch + 1) / head.slots_per_epoch) * 100;

  // emission: measured when the node serves it, computed on the live curve when not
  const slotBig = BigInt(head.slot);
  const emittedComputed = emittedDecayBy(slotBig);
  const emitted = supply && supply !== "absent" ? BigInt(supply.emitted_since_genesis_sat) : emittedComputed;
  const issued = supply && supply !== "absent" ? BigInt(supply.issued_sat) : GENESIS_ISSUED_SAT + emittedComputed;
  const issuedPct = Number((issued * 10_000n) / TOTAL_SUPPLY_SAT) / 100;
  const rewardNow = rewardDecaySat(slotBig);
  const yearNow = slotBig / SLOTS_PER_YEAR;
  const inflationPct = Number(annualInflationBps(yearNow)) / 100;

  // fees
  const baseNow = head.base_fee_millisat_per_gas ? BigInt(head.base_fee_millisat_per_gas) : null;
  const baseNext = head.next_base_fee_millisat_per_gas ? BigInt(head.next_base_fee_millisat_per_gas) : null;
  const atFloor = baseNext !== null && baseNext === MIN_BASE_FEE_MILLISAT_PER_GAS;

  // stake: both totals or neither
  const duty = vals ? BigInt(vals.total_active_stake_sat) : null;
  const consensus = stake && stake !== "absent" ? BigInt(stake.total_active_stake_sat) : null;
  const leakPct = duty && consensus && duty > 0n ? Number(((duty - consensus) * 10_000n) / duty) / 100 : null;

  const newest = [...ordered].reverse().slice(0, RECENT);
  const seats = Math.floor((vals?.active ?? head.validators?.active ?? G4.validators) / head.slots_per_epoch);

  return (
    <div className="container">
      <ChainOverview head={head} cells={ordered} mempool={mp} stale={!!err} />
      <p><Link to="/validators/guide">Run a validator →</Link> · Download the Bloch CLI, follow every setup step and check live admission status.</p>
      {/* ── the hero: head, finality, the clock ─────────────────────────── */}
      <section className="hero-card dash-hero">
        <div className="dash-hero-main">
          <div className="dash-hero-top">
            <span className="g4-badge">
              <span className={"dot " + (err ? "warn" : "live")} /> Genesis-4 · {err ? "last reading" : "observed"}
            </span>
            <CorroborationBadge c={corro} />
          </div>
          <h2 className="dash-title">Chain checkpoints</h2>
          <p className="dash-sub">
            {G4.validators} genesis validators · {G4.slotSecs} s slots · {head.slots_per_epoch}-slot
            epochs · ML-DSA ‖ Falcon signatures
          </p>
          <CorroborationNote c={corro} />

          <div className="dash-kpis">
            <div className="dash-kpi">
              <span className="k">Slot</span>
              <span className="v accent">{fmtInt(head.slot)}</span>
              <span className="s">
                wall clock says {fmtInt(wall)}
                {nodeLag > 0 ? <span className="txt-warn"> · node {fmtInt(nodeLag)} behind</span> : null}
              </span>
            </div>
            <div className="dash-kpi">
              <span className="k">Height</span>
              <span className="v">{fmtInt(head.height)}</span>
              <span className="s">
                {lifetimeFill !== null ? `${fmtNum((1 - lifetimeFill) * 100, 1)}% of slots ever missed` : "—"}
              </span>
            </div>
            <div className="dash-kpi">
              <span className="k">Epoch</span>
              <span className="v">
                {fmtInt(head.epoch)}
                <span className="dim">
                  slot {head.slot_in_epoch + 1}/{head.slots_per_epoch}
                </span>
              </span>
              <div className="meter" title={`${fmtNum(epochPct, 0)}% of this epoch has passed`}>
                <div className="meter-fill" style={{ width: `${epochPct}%` }} />
              </div>
              <span className="s">next boundary in {mmss(secsToEpoch)}</span>
            </div>
            <div className="dash-kpi">
              <span className="k">Justified</span>
              <span className="v">
                {fmtInt(head.justified.epoch)}
                <span className="dim">epoch</span>
              </span>
              <span className="s">
                <code>{head.justified.root.slice(0, 12)}</code>
              </span>
            </div>
            <div className="dash-kpi">
              <span className="k">Finalized</span>
              <span className="v">
                {finalised ? fmtInt(head.finalized.epoch) : "none"}
                {finalised && <span className="dim">epoch</span>}
              </span>
              <span className="s">
                {finalised ? <>height {fmtInt(head.finalized_height)} · <code>{head.finalized.root.slice(0, 12)}</code></> : "not yet"}
              </span>
            </div>
            <div className="dash-kpi">
              <span className="k">Finality lag</span>
              <span className={"v" + (stall.grade === "floor" || stall.grade === "lagging" ? "" : " txt-warn")}>
                {fmtInt(lag)}
                <span className="dim">{lag === 1 ? "epoch" : "epochs"}</span>
              </span>
              <span className="s">
                <span className={"pill " + (stall.grade === "floor" ? "ok" : stall.grade === "lagging" ? "quiet" : stall.grade === "capture" ? "bad" : "warn")}>
                  {stall.grade === "floor" ? "at the floor" : stall.grade}
                </span>
                floor is {CONSENSUS.floorGap}
              </span>
            </div>
          </div>

          <div className="dash-clock" aria-live="off">
            <span>
              <span className="clock-k">into slot</span>
              <b>{intoSlot.toFixed(0)}s</b> / {PARAMS.slotSecs.value}
            </span>
            <span>
              <span className="clock-k">node lag</span>
              <b className={nodeLag > 1 ? "lag-warn" : "lag-ok"}>{fmtInt(nodeLag)}</b> {nodeLag === 1 ? "slot" : "slots"}
            </span>
            <span>
              <span className="clock-k">chain age</span>
              <b>{fmtNum(ageDays, 1)}</b> days · {fmtInt(head.epoch)} epochs
            </span>
            <span>
              <span className="clock-k">genesis</span>
              <b>{G4.genesisTimeUtc}</b>
            </span>
            {readAt && (
              <span>
                <span className="clock-k">read</span>
                <b>{Math.max(0, Math.round((now - readAt) / 1000))}s</b> ago
              </span>
            )}
          </div>

          <div className="dash-roots">
            <span>
              head <Copyable text={head.block_id}><code>{head.block_id.slice(0, 20)}…</code></Copyable>
            </span>
            <span>
              state <Copyable text={head.state_root}><code>{head.state_root.slice(0, 20)}…</code></Copyable>
            </span>
          </div>
        </div>
      </section>

      {/* ── the instruments ─────────────────────────────────────────────── */}
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <Kpi
          k="Validators"
          v={vals ? fmtInt(vals.active) : head.validators ? fmtInt(head.validators.active) : "—"}
          sub={
            vals
              ? `counted active of ${fmtInt(vals.total)} registered`
              : head.validators
                ? `counted active of ${fmtInt(head.validators.total)} registered`
                : "the validator count did not answer this round"
          }
        />
        <Kpi
          k="Consensus stake"
          v={consensus !== null ? fmtCompactBloch(consensus) : stake === "absent" ? "not served" : "—"}
          unit={consensus !== null ? "BLCH" : undefined}
          tone={consensus === null ? "absent" : undefined}
          sub={
            consensus !== null
              ? `${fmtBloch(consensus, 0)} BLCH post-leak — quorum is taken on this`
              : stake === "absent"
                ? "getstakedistribution is in the node source, not in the deployed build"
                : "reading…"
          }
          title="Two thirds of THIS total justifies an epoch. It is not the duty stake below."
        />
        <Kpi
          k="Duty stake"
          v={duty !== null ? fmtCompactBloch(duty) : "—"}
          unit={duty !== null ? "BLCH" : undefined}
          sub={duty !== null ? `${fmtBloch(duty, 0)} BLCH bonded, before the leak` : "bonded roster before the leak"}
        />
        <Kpi
          k="Leaked away"
          v={leakPct !== null ? `${fmtNum(leakPct, 1)}%` : "—"}
          tone={leakPct !== null && leakPct > 0 ? "crit" : undefined}
          sub={leakPct !== null ? "of the bond, permanently — see validators" : "needs both stake totals"}
        />
        <Kpi
          k="Mempool entries"
          v={mp ? fmtInt(mp.size) : head.mempool !== undefined ? fmtInt(head.mempool) : "—"}
          sub={mp ? `${fmtBytes(mp.bytes)} held · capacity ${fmtInt(mp.max)}` : "one node's view"}
          tag={<span className="pill quiet pill-sm">node-local</span>}
          title="Local pool entries may include residual copies of transactions already included. Check the transaction ID for inclusion status."
        />
        <Kpi
          k="Base fee"
          v={baseNow !== null ? baseNow.toString() : "—"}
          unit="msat/gas"
          sub={baseNext !== null ? `next block ${baseNext.toString()} msat/gas` : "next price not reported"}
          tag={atFloor ? <span className="pill brass pill-sm">at floor</span> : undefined}
        />
        <Kpi
          k="Issued supply"
          v={fmtCompactBloch(issued)}
          unit="BLCH"
          sub={
            supply && supply !== "absent"
              ? `${fmtBloch(issued, 0)} · ${fmtNum(issuedPct, 2)}% of the cap · getsupply at slot ${fmtInt(supply.at_slot)}`
              : `${fmtBloch(issued, 0)} · ${fmtNum(issuedPct, 2)}% of the cap · computed on the live decay curve`
          }
          title="Gross and monotone. Not circulating supply — burns never decrement it."
        >
          <div className="meter">
            <div className="meter-fill" style={{ width: `${issuedPct}%` }} />
          </div>
        </Kpi>
        <Kpi
          k="Emission now"
          v={fmtCompactBloch(rewardNow)}
          unit="BLCH"
          sub={`per block · ${fmtNum(inflationPct, 2)}% of total supply this year · ${fmtCompactBloch(emitted)} emitted so far`}
        />
      </section>

      {/* ── production: the last epoch of slots ─────────────────────────── */}
      <section className="card">
        <div className="dash-prod-head">
          <h2 className="snap-h2" style={{ margin: 0 }}>Production — the last {WINDOW} slots</h2>
          <span className="pill brass pill-sm">{fmtInt(stats.blocks)} blocks</span>
          <span className="pill quiet pill-sm">{fmtInt(stats.empty)} missed</span>
          {stats.unknown > 0 && <span className="pill unknown pill-sm">{fmtInt(stats.unknown)} unread</span>}
          {ordered.length < Math.min(WINDOW, head.slot + 1) && (
            <span className="pill quiet pill-sm">reading {fmtInt(ordered.length)}/{Math.min(WINDOW, head.slot + 1)}</span>
          )}
          <span className="spacer" />
          <Link to="/blocks" className="pill-tab">every slot →</Link>
          <Link to="/analytics" className="pill-tab">analytics →</Link>
        </div>
        {ordered.length === 0 ? (
          <Loading label="Reading the last epoch of slots…" />
        ) : (
          <>
            <SlotStrip cells={ordered} current={head.slot} variant="tall" />
            <div className="dash-strip-axis">
              <span>slot {fmtInt(ordered[0].slot)}</span>
              <span>slot {fmtInt(ordered[ordered.length - 1].slot)} · head</span>
            </div>
            <StripLegend />
            <div className="stats dash-prod-stats">
              <div className="stat">
                <span className="label">Fill rate</span>
                <span className="value">{stats.fillRate === null ? "—" : `${fmtNum(stats.fillRate * 100, 0)}%`}</span>
                <span className="sub">of readable slots produced a block</span>
              </div>
              <div className="stat">
                <span className="label">Transactions</span>
                <span className="value">{fmtInt(stats.txs)}</span>
                <span className="sub">carried in this window</span>
              </div>
              <div className="stat">
                <span className="label">Attestations</span>
                <span className="value">{stats.meanAttestations === null ? "—" : fmtNum(stats.meanAttestations, 2)}</span>
                <span className="sub">mean per block · {seats} seats per slot is full</span>
              </div>
              <div className="stat">
                <span className="label">Proposers</span>
                <span className="value">{fmtInt(stats.distinctProposers)}</span>
                <span className="sub">distinct validators built these blocks</span>
              </div>
              <div className="stat">
                <span className="label">Block interval</span>
                <span className="value">{stats.meanIntervalSecs === null ? "—" : `${fmtNum(stats.meanIntervalSecs, 0)}s`}</span>
                <span className="sub">mean · {PARAMS.slotSecs.value}s is one slot</span>
              </div>
            </div>
            <SlotTable cells={newest} />
          </>
        )}
        <p className="lookup-hint">
          A missed slot is a proposal that did not arrive in time. It costs that validator its
          reward for the slot and nothing else — the chain moves on to the next, and height does
          not advance. An unread slot is one the archivals did not answer for; it is not counted as
          missed, because we do not know that it was.
        </p>
      </section>

      <div className="grid two-col" style={{ marginBottom: 14 }}>
        {/* ── finality snapshot ──────────────────────────────────────────── */}
        <section className="card">
          <h2 className="snap-h2">Finality</h2>
          <div className="dash-cps">
            <div className="dash-cp head">
              <span className="k">head</span>
              <span className="v">{fmtInt(head.epoch)}</span>
              <span className="s">slot {head.slot_in_epoch + 1}/{head.slots_per_epoch}</span>
            </div>
            <div className="dash-cp-gap"><i />{head.epoch - head.justified.epoch}</div>
            <div className="dash-cp justified">
              <span className="k">justified</span>
              <span className="v">{fmtInt(head.justified.epoch)}</span>
              <span className="s"><code>{head.justified.root.slice(0, 12)}</code></span>
            </div>
            <div className="dash-cp-gap"><i />{head.justified.epoch - head.finalized.epoch}</div>
            <div className="dash-cp final">
              <span className="k">finalized</span>
              <span className="v">{fmtInt(head.finalized.epoch)}</span>
              <span className="s"><code>{head.finalized.root.slice(0, 12)}</code></span>
            </div>
          </div>
          <div className={"dash-stall " + stall.grade}>
            <div>
              <strong>{stall.headline}</strong>
              {stall.detail}
            </div>
          </div>
          <p className="lookup-hint">
            Production and finality are separate questions. A block every slot says proposers are
            healthy; a finalized epoch says two thirds of the <em>consensus</em> stake agreed — the
            post-leak roster, not the duty total. Two epochs of lag is the floor: finalizing epoch{" "}
            <em>n</em> requires epoch <em>n+1</em> to justify on top of it. Finality is not a latch
            on this chain — <Link to="/finality">what the guarantee is worth</Link>.
          </p>
        </section>

        {/* ── stake & operators ──────────────────────────────────────────── */}
        <section className="card">
          <h2 className="snap-h2">Stake, and who holds it</h2>
          {duty !== null ? (
            <div className="dash-stake">
              <div className="dash-stake-row">
                <span className="k">duty roster</span>
                <div className="dash-stake-track"><div className="dash-stake-fill" style={{ width: "100%" }} /></div>
                <span className="n">{fmtBloch(duty, 0)}</span>
              </div>
              <div className="dash-stake-row">
                <span className="k">consensus</span>
                <div className="dash-stake-track">
                  {consensus !== null ? (
                    <>
                      <div className="dash-stake-fill" style={{ width: `${100 - (leakPct ?? 0)}%` }} />
                      <div className="dash-stake-fill leak" style={{ width: `${leakPct ?? 0}%` }} />
                    </>
                  ) : null}
                </div>
                <span className="n">{consensus !== null ? fmtBloch(consensus, 0) : <span className="g4-absent">not served</span>}</span>
              </div>
            </div>
          ) : (
            <p className="lookup-hint">The validator count did not answer this round.</p>
          )}
          <p className="lookup-hint">
            {leakPct !== null ? (
              <>
                The hatched part — <strong>{fmtNum(leakPct, 1)}%</strong> of every bond — is weight
                the inactivity leak took during past epochs of non-finality. It does not come back:
                the recovery path is compiled in and held behind an inert flag day.{" "}
              </>
            ) : null}
            Every one of the {fmtInt(vals?.total ?? G4.validators)} validators declares the same
            withdrawal address, so a concentration figure by index measures nothing — the set is
            one operator. <Link to="/validators">Every validator</Link>, with its bond and what is
            left of it. <Link to="/supply">Where the supply sits</Link>.
          </p>
        </section>
      </div>

      {/* ── transactions: where they landed in this window ──────────────── */}
      <section className="card">
        <div className="card-head">
          <h2 className="snap-h2" style={{ margin: 0 }}>Latest transactions</h2>
          <span className={"pill pill-sm " + (stats.txs > 0 ? "ok" : "quiet")}>{fmtInt(stats.txs)} in the last {WINDOW} slots</span>
          <span className="spacer" />
          <Link to="/transactions" className="pill-tab">transactions →</Link>
        </div>
        {stats.txs > 0 ? (
          <TxLandings cells={ordered} limit={6} />
        ) : (
          <p className="lookup-hint" style={{ margin: 0 }}>
            No block in the last {WINDOW} slots carried a transaction — usual here, and not a fault:
            the opening ledger was issued at genesis rather than transferred into place. The chain
            says how many transactions a block carried and not which; where they last landed, and
            each one when an indexer is attached, is on the <Link to="/transactions">transactions page</Link>.
          </p>
        )}
      </section>

      {/* ── how this page was served ────────────────────────────────────── */}
      <section className="card dash-served">
        <h2 className="snap-h2" style={{ marginBottom: 6 }}>How this page was served</h2>
        <p style={{ margin: 0 }}>
          Every read goes through this site's own edge on <code>/rpc</code>, which asks two keyless
          archival observers, requires them to agree, certifies their lineage against a fleet
          validator on a schedule, and caches on immutability. A validator is never polled for a
          web page.
        </p>
        <dl>
          <div>
            <dt>corroboration</dt>
            <dd>{corro ? corro.level : "—"}</dd>
          </div>
          <div>
            <dt>archivals agreeing</dt>
            <dd>{corro?.archival_witnesses !== undefined ? `${corro.archival_witnesses} of ${corro.of}` : "—"}</dd>
          </div>
          <div>
            <dt>fleet witness</dt>
            <dd>
              {corro?.witness
                ? corro.witness.available
                  ? `${Math.round((corro.witness.age_ms ?? 0) / 1000)}s old · height ${corro.witness.height ?? "—"}`
                  : `unavailable (${corro.witness.reason ?? "—"})`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>archival plane</dt>
            <dd>
              {corro?.plane
                ? corro.plane.certified
                  ? "certified on the fleet's lineage"
                  : `not certified (${corro.plane.reason ?? "—"})`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>lineage events seen</dt>
            <dd>{corro?.reorg_events?.length ? `${corro.reorg_events.length} — cached answers discarded` : "none"}</dd>
          </div>
          <div>
            <dt>this reading</dt>
            <dd>{readAt ? fmtTime(readAt / 1000) : "—"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
