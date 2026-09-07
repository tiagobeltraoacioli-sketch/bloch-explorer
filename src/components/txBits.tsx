// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Transaction pieces shared by the transactions page, the block page and the
// transaction page — so a transaction looks the same wherever a reader meets
// it, and so the one caveat that travels with every transaction on this chain
// is rendered by one component rather than remembered by four pages.
//
// Two tiers of truth, and the components below belong to one or the other:
//
//   THE CHAIN says how many transactions a block carried and, for any
//   outpoint, whether it is unspent right now. `TxLandings` and
//   `OutpointCheck` draw on that and nothing else.
//
//   THE INDEXER, when one is attached, says which transactions they were.
//   `TxRows` renders that, and is never shown without the indexer's
//   `as_of_slot` beside it.
import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { g4rpc, G4TxOut } from "../lib/g4";
import { IndexedTx, sumSide } from "../lib/indexer";
import { SlotCell, slotStartMs } from "../lib/slots";
import { FinalityBadge } from "./blockstream";
import { fmtBloch, fmtInt, short, timeAgo } from "../lib/format";

/** A transaction id as a link — to the transaction page, which knows what to do with an unindexed one. */
export function TxidLink({ txid, head = 10, tail = 6 }: { txid: string; head?: number; tail?: number }) {
  return (
    <Link to={`/tx/${txid}`} className="mono-link" title={txid}>
      {short(txid, head, tail)}
    </Link>
  );
}

/** Indexed transactions, newest first. Only ever rendered with the indexer's as-of slot beside it. */
export function TxRows({
  txs,
  asOfSlot,
  showBlock = true,
}: {
  txs: IndexedTx[];
  asOfSlot: number;
  showBlock?: boolean;
}) {
  if (txs.length === 0) return <p className="lookup-hint">The indexer holds no transactions here.</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="tbl tx-table">
          <thead>
            <tr>
              <th>Transaction</th>
              {showBlock && <th className="num">Slot</th>}
              {showBlock && <th className="num">Height</th>}
              <th>Kind</th>
              <th className="num">In → out</th>
              <th className="num">Moved</th>
              <th className="num">Fee</th>
              <th className="num">Size</th>
              {showBlock && <th>Age</th>}
            </tr>
          </thead>
          <tbody>
            {txs.map((t) => {
              const out = sumSide(t.outputs);
              return (
                <tr key={t.txid}>
                  <td><TxidLink txid={t.txid} /></td>
                  {showBlock && <td className="num"><Link to={`/slot/${t.slot}`}>{fmtInt(t.slot)}</Link></td>}
                  {showBlock && <td className="num">{fmtInt(t.height)}</td>}
                  <td><span className="pill quiet pill-sm">{t.kind}</span></td>
                  <td className="num">{fmtInt(t.inputs.length)} → {fmtInt(t.outputs.length)}</td>
                  <td className="num">{out === null ? <span className="faint">unreadable</span> : `${fmtBloch(out, 4)} BLOCH`}</td>
                  <td className="num">{/^[0-9]+$/.test(t.fee_sat) ? `${fmtInt(t.fee_sat)} sat` : <span className="faint">—</span>}</td>
                  <td className="num">{fmtInt(t.size_bytes)} B</td>
                  {showBlock && <td className="faint">{timeAgo(slotStartMs(t.slot) / 1000)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="lookup-hint">
        From the indexer, as of slot {fmtInt(asOfSlot)}. "Moved" is the sum of the outputs; the fee
        is what the inputs exceed them by, which is exactly the quantity consensus checks with{" "}
        <code>!=</code>. Nothing on the wire says who paid whom — an output names a script hash,
        not a person.
      </p>
    </>
  );
}

/**
 * Blocks that carried transactions, from a window of slots the chain answered.
 *
 * This is what the RPC can tell you about transactions without an indexer:
 * where they landed and how many. The block page for each row says the rest.
 */
export function TxLandings({ cells, limit }: { cells: SlotCell[]; limit?: number }) {
  const rows = cells
    .filter((c): c is Extract<SlotCell, { kind: "block" }> => c.kind === "block" && c.block.tx_count > 0)
    .sort((a, b) => b.slot - a.slot)
    .slice(0, limit ?? cells.length);
  if (rows.length === 0) return null;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th className="num">Slot</th>
            <th className="num">Height</th>
            <th className="num">Proposer</th>
            <th>Block</th>
            <th className="num">Txs</th>
            <th>State</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const b = c.block;
            return (
              <tr key={b.block_id}>
                <td className="num"><Link to={`/slot/${b.slot}`}>{fmtInt(b.slot)}</Link></td>
                <td className="num">{b.height === null ? "—" : fmtInt(b.height)}</td>
                <td className="num"><Link to={`/validators/${b.proposer_index}`}>v{b.proposer_index}</Link></td>
                <td><Link to={`/block/${b.block_id}`} className="mono-link"><code>{short(b.block_id, 10, 6)}</code></Link></td>
                <td className="num"><span className="pill ok pill-sm">{fmtInt(b.tx_count)}</span></td>
                <td><FinalityBadge block={b} /></td>
                <td className="faint">{timeAgo(b.timestamp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Check =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; out: G4TxOut }
  | { kind: "error"; message: string };

/**
 * Ask `gettxout` about one outpoint, and render the answer with the caveat it
 * needs. The caveat is not optional: `unspent: false` is the identical answer
 * for an output that was spent, one that never existed, and a node-local
 * `tx_hash` from `sendrawtransaction` — so it is never rendered as "spent".
 */
export function OutpointCheck({ seedTxid }: { seedTxid?: string }) {
  const [txid, setTxid] = useState(seedTxid ?? "");
  const [vout, setVout] = useState("0");
  const [st, setSt] = useState<Check>({ kind: "idle" });
  useEffect(() => {
    if (seedTxid) setTxid(seedTxid);
  }, [seedTxid]);
  const ok = /^[0-9a-f]{64}$/i.test(txid.trim()) && /^\d{1,6}$/.test(vout.trim());

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setSt({ kind: "busy" });
    try {
      const out = await g4rpc<G4TxOut>("gettxout", [txid.trim().toLowerCase(), Number(vout)]);
      setSt({ kind: "done", out });
    } catch (err: any) {
      setSt({ kind: "error", message: String(err?.message ?? err) });
    }
  }

  return (
    <form className="opcheck" onSubmit={run}>
      <label className="lookup-label" htmlFor="opcheck-txid">Check an outpoint against the unspent set</label>
      <div className="opcheck-row">
        <input
          id="opcheck-txid"
          className="lookup-input"
          placeholder="64-hex transaction id"
          value={txid}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => { setTxid(e.target.value); setSt({ kind: "idle" }); }}
        />
        <span className="opcheck-colon">:</span>
        <input
          className="lookup-input opcheck-vout"
          placeholder="vout"
          value={vout}
          inputMode="numeric"
          onChange={(e) => { setVout(e.target.value); setSt({ kind: "idle" }); }}
          aria-label="output index"
        />
        <button className="lookup-go" type="submit" disabled={!ok || st.kind === "busy"}>
          {st.kind === "busy" ? "asking…" : "ask gettxout"}
        </button>
      </div>
      {st.kind === "error" && <div className="err-box" style={{ marginTop: 10 }}>{st.message}</div>}
      {st.kind === "done" && (
        <div className={"callout " + (st.out.unspent ? "callout-brass" : "")} style={{ marginBottom: 0 }}>
          {st.out.unspent && st.out.utxo ? (
            <>
              <strong>Unspent.</strong> {fmtBloch(st.out.utxo.value_sat, 8)} BLOCH, locked to{" "}
              <Link to={`/hash/${st.out.utxo.script_hash}`} className="mono-link">{short(st.out.utxo.script_hash, 12, 8)}</Link>,
              at head slot {fmtInt(st.out.at_slot)}. That proves the output exists and is unspent right
              now — inclusion, not finality.{" "}
              <Link to={`/outpoint/${txid.trim().toLowerCase()}:${Number(vout)}`}>The outpoint page</Link> has the rest.
            </>
          ) : (
            <>
              <strong>No unspent output under this key</strong> at head slot {fmtInt(st.out.at_slot)}.
              That is not "spent": it is the identical answer for an output that was spent, one that
              never existed, and a node-local <code>tx_hash</code> from{" "}
              <code>sendrawtransaction</code>, which other nodes do not agree on.{" "}
              <Link to={`/tx/${txid.trim().toLowerCase()}`}>What a transaction hash means here</Link>.
            </>
          )}
        </div>
      )}
    </form>
  );
}
