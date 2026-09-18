// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The front door.
//
// A 32-byte query may name a block, transaction or script hash. Resolve
// positive evidence first, then open the transaction observer-status page.
// See `lib/query.ts` for the input grammar.
//
// Three behaviours are deliberate and all three are departures from what the
// box used to do:
//
//   1. **A bare number is not silently read as a slot.** Slot and height are
//      different numbers here — 20,895 apart today, because 38.3% of slots
//      carry no block — and there is no `getblockbyheight` to resolve the
//      second. Guessing sends a reader thinking in heights to a page about a
//      completely different block that looks perfectly correct. So the box
//      asks, and resolves a height properly when that is what was meant.
//
//   2. **A 32-byte value that resolves to nothing routes to transaction status,
//      not to a 404.** It is almost always a `tx_hash`. See `pages/TxAnswer`.
//
//   3. **A bad address checksum is refused, not stripped.** The zero-padded
//      hash of a mistyped address is a valid script hash that holds nothing,
//      so accepting it would show a confident empty balance for an address
//      that was never typed correctly.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "../lib/router";
import { parseQuery, Candidate } from "../lib/query";
import { read, RpcRefusal, CODE, findSlotForHeight, HeightSearch } from "../lib/source";
import { probeOutcome, verdictFor, isReadableBalance } from "../lib/resolve64";
import { G4Block, G4Head } from "../lib/g4";
import { fmtInt } from "../lib/format";

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; what: string }
  /** A bare number: we cannot tell slot from height, so the reader picks. */
  | { kind: "choose"; n: number; slotHint: string | null }
  | { kind: "heightSearch"; height: number; probes: number }
  | { kind: "heightNarrowed"; height: number; lo: number; hi: number }
  | { kind: "error"; message: string };

/** The id the shell focuses on ⌘K / "/" — one box, reachable from anywhere. */
export const SEARCH_INPUT_ID = "g4-search-input";

interface Destination {
  label: string;
  to: string;
  hint: string;
  terms: string;
}

/** Human destinations complement the identifier grammar without weakening it. */
const DESTINATIONS: Destination[] = [
  { label: "Chain overview", to: "/", hint: "head, finality and production", terms: "home dashboard chain overview head" },
  { label: "Blocks & slots", to: "/blocks", hint: "browse the canonical slot timeline", terms: "blocks slots timeline" },
  { label: "Transactions", to: "/transactions", hint: "landings and observer status", terms: "transactions tx transfers" },
  { label: "Validators", to: "/validators", hint: "stake, activity and participation", terms: "validators staking participation" },
  { label: "Finality", to: "/finality", hint: "checkpoints, support and stalls", terms: "finality checkpoints quorum" },
  { label: "Analytics", to: "/analytics", hint: "epochs, proposers and emission", terms: "analytics metrics epochs charts" },
  { label: "Mempool", to: "/mempool", hint: "pending load and admission", terms: "mempool pending transactions" },
  { label: "Network & API", to: "/network", hint: "observers, builds and RPC surface", terms: "network api rpc nodes observers" },
  { label: "Supply", to: "/supply", hint: "issuance and concentration", terms: "supply issuance tokenomics" },
  { label: "Fees", to: "/fees", hint: "base fee and recent gas use", terms: "fees gas price" },
  { label: "Validator guide", to: "/validators/guide", hint: "run a Genesis-4 validator", terms: "validator guide run setup operations" },
  { label: "Genesis-3 snapshot", to: "/snapshot", hint: "inspect the handover ledger", terms: "snapshot genesis 3 carryover" },
];

export function G4Search({ hero }: { hero?: boolean }) {
  const { navigate } = useRouter();
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [selected, setSelected] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const suggestions = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !/^[a-z\s&-]+$/i.test(needle)) return [];
    return DESTINATIONS.filter((d) => `${d.label} ${d.terms}`.toLowerCase().includes(needle)).slice(0, 6);
  }, [q]);
  const showSuggestions = phase.kind === "idle" && suggestions.length > 0;

  useEffect(() => () => abort.current?.abort(), []);

  const reset = () => {
    abort.current?.abort();
    abort.current = null;
    setPhase({ kind: "idle" });
  };

  const go = (to: string) => {
    reset();
    setQ("");
    navigate(to);
  };

  /** Resolve a 32-byte value: block id, then funded script hash, then tx_hash. */
  async function resolve32(hex: string, signal: AbortSignal) {
    setPhase({ kind: "busy", what: "Asking whether that is a block…" });
    try {
      // `getblockbyid` serves non-canonical blocks too, so this also finds an
      // orphan — which `getblockbyslot` structurally cannot.
      const b = await read<G4Block>("getblockbyid", [hex], { signal });
      if (signal.aborted) return;
      go(b.finality === "not_canonical" ? `/block/${hex}` : `/slot/${b.slot}`);
      return;
    } catch (e) {
      // Classified through `lib/resolve64.ts` rather than inline, so the rule
      // the tests pin and the rule the bundle ships are the same line. The
      // trap it encodes: `-32050` (our proxy found no archival) arrives shaped
      // exactly like a node refusal, code and all, so "it has a code" is not
      // "the chain spoke".
      if (probeOutcome(e) === "endpoint_fault") {
        if (signal.aborted) return;
        // Could not ask. Do not fall through to "it must be an address" —
        // that would turn an outage into a wrong answer.
        setPhase({ kind: "error", message: `Could not reach the chain: ${(e as Error).message}` });
        return;
      }
    }

    setPhase({ kind: "busy", what: "Not a block. Checking the ledger…" });
    try {
      const bal = await read<{ balance_sat: string; utxo_count: number }>(
        "getbalance",
        [hex],
        { signal },
      );
      // Only route to the entry page when the reading actually established
      // something. Every 32-byte value has a balance of zero, so a zero is not
      // evidence that this was a script hash — and routing a tx_hash to a
      // balance page showing 0 is the confident-wrong-answer failure again.
      //
      // `verdictFor` also keeps the one case a bare non-zero test got wrong: a
      // raw 64-hex in the CARRIED shape holding nothing is a real, reportable
      // empty carried entry, not an unknown, and belongs on the entry page.
      if (signal.aborted) return;
      if (isReadableBalance(bal) && verdictFor(hex, bal) !== "indeterminate") {
        go(`/hash/${hex}`);
        return;
      }
    } catch {
      /* The transaction page can still ask for observer status. */
    }
    if (signal.aborted) return;

    // Not a block, and nothing holds a balance under it. Overwhelmingly the
    // likeliest thing a person is holding that looks like this.
    go(`/tx/${hex}`);
  }

  async function runHeight(height: number, signal: AbortSignal, budget?: number) {
    setPhase({ kind: "heightSearch", height, probes: 0 });
    let head: G4Head;
    try {
      head = await read<G4Head>("getchaininfo", [], { signal });
    } catch (e) {
      if (signal.aborted) return;
      setPhase({ kind: "error", message: `Could not read the head: ${(e as Error).message}` });
      return;
    }
    const r: HeightSearch = await findSlotForHeight(height, head, {
      signal,
      maxProbes: budget,
      onProgress: (probes) => setPhase({ kind: "heightSearch", height, probes }),
    });
    if (signal.aborted) return;
    if (r.kind === "found") go(`/slot/${r.slot}`);
    else if (r.kind === "future") {
      setPhase({
        kind: "error",
        message: `The chain is at height ${fmtInt(r.headHeight)}; ${fmtInt(height)} does not exist yet.`,
      });
    } else setPhase({ kind: "heightNarrowed", height, lo: r.lo, hi: r.hi });
  }

  async function take(c: Candidate) {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    switch (c.kind) {
      case "slot":
        go(`/slot/${c.slot}`);
        return;
      case "validator":
        go(`/validators/${c.index}`);
        return;
      case "epoch":
        go(`/epoch/${c.epoch}`);
        return;
      case "scriptHash":
        go(`/hash/${c.scriptHash}`);
        return;
      case "outpoint":
        go(`/outpoint/${c.txid}:${c.vout}`);
        return;
      case "blockId":
        await resolve32(c.blockId, ac.signal);
        return;
      case "height":
        await runHeight(c.height, ac.signal);
        return;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (showSuggestions) {
      go(suggestions[Math.min(selected, suggestions.length - 1)].to);
      return;
    }
    reset();
    const parsed = parseQuery(q);
    if (parsed.candidates.length === 0) {
      setPhase({
        kind: "error",
        message: q.trim().startsWith("bloch1")
          ? "That address does not checksum. Retype it — a mistyped address maps to a valid-looking key that simply holds nothing, so we will not guess."
          : "Not a slot, a height, an epoch, a validator index, an address, a script hash, a block id or an outpoint.",
      });
      return;
    }

    // The ambiguity we refuse to resolve for the reader. Everything else the
    // chain can settle; this one it cannot, because both readings are valid
    // numbers and only the reader knows which they meant.
    if (parsed.mustChoose) {
      const n = (parsed.candidates[0] as { slot: number }).slot;
      setPhase({ kind: "choose", n, slotHint: null });
      // Peek at what that slot holds, so the choice is informed rather than
      // abstract — showing "slot 33,690 is empty" next to the choice is often
      // enough on its own to tell the reader they meant a height.
      const ac = new AbortController();
      abort.current = ac;
      try {
        const b = await read<G4Block>("getblockbyslot", [n], { signal: ac.signal });
        if (!ac.signal.aborted) {
          setPhase({
            kind: "choose",
            n,
            slotHint: `holds block ${b.block_id.slice(0, 12)}… at height ${fmtInt(b.height ?? 0)}`,
          });
        }
      } catch (err) {
        if (!ac.signal.aborted && err instanceof RpcRefusal && err.code === CODE.SLOT_EMPTY) {
          setPhase({ kind: "choose", n, slotHint: "is empty — the proposer missed it" });
        }
      }
      return;
    }

    await take(parsed.candidates[0]);
  }

  return (
    <div className={"search-wrap" + (hero ? " hero" : "")}>
      <form className={"search" + (hero ? " hero" : "")} onSubmit={submit} role="search">
        <svg className="search-ico" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          id={hero ? undefined : SEARCH_INPUT_ID}
          className="search-input"
          placeholder={hero ? "Slot, height, epoch, block id, transaction id, address, script hash, outpoint, v‹n›" : "Search…"}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSelected(0);
            if (phase.kind !== "idle") reset();
          }}
          onKeyDown={(e) => {
            if (!showSuggestions) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => (i + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => (i - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setQ("");
              setSelected(0);
            }
          }}
          spellCheck={false}
          autoComplete="off"
          aria-label="Search Genesis-4"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls={showSuggestions ? "explorer-destinations" : undefined}
          aria-activedescendant={showSuggestions ? `explorer-destination-${selected}` : undefined}
        />
        {!hero && phase.kind === "idle" && !q && <kbd className="kbd">⌘K</kbd>}
        <button className="search-go" type="submit" disabled={phase.kind === "busy"}>
          {phase.kind === "busy" || phase.kind === "heightSearch" ? "…" : "Go"}
        </button>
      </form>

      {showSuggestions && (
        <div className="search-palette" id="explorer-destinations" role="listbox" aria-label="Explorer destinations">
          <div className="palette-label">Jump to</div>
          {suggestions.map((destination, i) => (
            <button
              key={destination.to}
              id={`explorer-destination-${i}`}
              className={"palette-option" + (i === selected ? " selected" : "")}
              type="button"
              role="option"
              aria-selected={i === selected}
              onMouseEnter={() => setSelected(i)}
              onClick={() => go(destination.to)}
            >
              <span>{destination.label}</span>
              <small>{destination.hint}</small>
              <kbd>↵</kbd>
            </button>
          ))}
          <div className="palette-foot"><kbd>↑</kbd><kbd>↓</kbd> choose <span>·</span> <kbd>↵</kbd> open <span>·</span> IDs still resolve through the chain</div>
        </div>
      )}

      {phase.kind === "busy" && <div className="search-note">{phase.what}</div>}

      {phase.kind === "error" && <div className="search-err">{phase.message}</div>}

      {phase.kind === "choose" && (
        <div className="search-choose">
          <div className="choose-lede">
            <strong>{fmtInt(phase.n)}</strong> could be a slot or a height, and on this chain
            they differ whenever a slot produces no block. Which did you mean?
          </div>
          <div className="choose-opts">
            <button className="pill-tab go" onClick={() => take({ kind: "slot", slot: phase.n })}>
              Slot {fmtInt(phase.n)}
              {phase.slotHint && <span className="choose-hint"> — {phase.slotHint}</span>}
            </button>
            <button className="pill-tab" onClick={() => take({ kind: "height", height: phase.n })}>
              Height {fmtInt(phase.n)}
              <span className="choose-hint"> — needs a search; there is no lookup by height</span>
            </button>
            {phase.n < 1024 && (
              <button
                className="pill-tab"
                onClick={() => take({ kind: "validator", index: phase.n })}
              >
                Validator v{phase.n}
              </button>
            )}
          </div>
        </div>
      )}

      {phase.kind === "heightSearch" && (
        <div className="search-note">
          Searching for height {fmtInt(phase.height)} — {phase.probes} slots probed. There is no
          lookup by height, so this closes a bracket on it.
        </div>
      )}

      {phase.kind === "heightNarrowed" && (
        <div className="search-choose">
          <div className="choose-lede">
            Height {fmtInt(phase.height)} is somewhere in slots {fmtInt(phase.lo)}–
            {fmtInt(phase.hi)}, and the search ran out of budget before pinning it down. That
            range is inside the stretch where the chain barely produced — most slots there are
            empty, so probes come back with nothing to learn from. It is findable, just
            expensive.
          </div>
          <div className="choose-opts">
            <button
              className="pill-tab go"
              onClick={() => {
                const ac = new AbortController();
                abort.current = ac;
                void runHeight(phase.height, ac.signal, 600);
              }}
            >
              Keep looking
            </button>
            <button className="pill-tab" onClick={() => go(`/blocks/${phase.hi}`)}>
              Browse slots {fmtInt(phase.lo)}–{fmtInt(phase.hi)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
