// SPDX-License-Identifier: AGPL-3.0-or-later
import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, Link } from "./lib/router";
import { Route, match } from "./routes";
import { G4Search, SEARCH_INPUT_ID } from "./components/g4search";
import { g4HeadWithMeta, pollWhileVisible, G4Head, G4Corroboration } from "./lib/g4";
import { fmtInt } from "./lib/format";
import { toggleTheme, useTheme } from "./lib/theme";
import { G4Dashboard } from "./pages/G4Dashboard";
import { RouteBoundary } from "./components/RouteBoundary";
// The dashboard is the only eager page. Every specialist surface is loaded on
// demand, keeping the first visit light even as the explorer grows richer.
const FinalityPage = lazy(() => import("./pages/Finality").then((m) => ({ default: m.FinalityPage })));
const G4BlockPage = lazy(() => import("./pages/G4Block").then((m) => ({ default: m.G4BlockPage })));
const G4BlocksPage = lazy(() => import("./pages/G4Blocks").then((m) => ({ default: m.G4BlocksPage })));
const TxAnswerPage = lazy(() => import("./pages/TxAnswer").then((m) => ({ default: m.TxAnswerPage })));
const BalancePage = lazy(() => import("./pages/Balance").then((m) => ({ default: m.BalancePage })));
const HashPage = lazy(() => import("./pages/Hash").then((m) => ({ default: m.HashPage })));
const OutpointPage = lazy(() => import("./pages/Outpoint").then((m) => ({ default: m.OutpointPage })));
const ValidatorsPage = lazy(() => import("./pages/Validators").then((m) => ({ default: m.ValidatorsPage })));
const ValidatorDetailPage = lazy(() => import("./pages/ValidatorDetail").then((m) => ({ default: m.ValidatorDetailPage })));
const ValidatorQueuesPage = lazy(() => import("./pages/ValidatorQueues").then((m) => ({ default: m.ValidatorQueuesPage })));
const SnapshotPage = lazy(() => import("./pages/Snapshot").then((m) => ({ default: m.SnapshotPage })));
const SupplyPage = lazy(() => import("./pages/Supply").then((m) => ({ default: m.SupplyPage })));
const FeesPage = lazy(() => import("./pages/Fees").then((m) => ({ default: m.FeesPage })));
const AnalyticsPage = lazy(() => import("./pages/Analytics").then((m) => ({ default: m.AnalyticsPage })));
const EpochPage = lazy(() => import("./pages/Epoch").then((m) => ({ default: m.EpochPage })));
const TransactionsPage = lazy(() => import("./pages/Transactions").then((m) => ({ default: m.TransactionsPage })));
const MempoolPage = lazy(() => import("./pages/Mempool").then((m) => ({ default: m.MempoolPage })));
const NetworkPage = lazy(() => import("./pages/Network").then((m) => ({ default: m.NetworkPage })));
const ObservabilityPage = lazy(() => import("./pages/Observability").then((m) => ({ default: m.ObservabilityPage })));
const ValidatorGuidePage = lazy(() => import("./pages/ValidatorGuide").then((m) => ({ default: m.ValidatorGuidePage })));

// Begin fetching a specialist view while the reader is already aiming at its
// link. Dynamic imports are module-cached, so the subsequent lazy render reuses
// the same request instead of making a second one.
const ROUTE_PRELOADERS: Record<string, () => Promise<unknown>> = {
  "/blocks": () => import("./pages/G4Blocks"),
  "/transactions": () => import("./pages/Transactions"),
  "/analytics": () => import("./pages/Analytics"),
  "/finality": () => import("./pages/Finality"),
  "/validators": () => import("./pages/Validators"),
  "/validators/guide": () => import("./pages/ValidatorGuide"),
  "/supply": () => import("./pages/Supply"),
  "/mempool": () => import("./pages/Mempool"),
  "/network": () => import("./pages/Network"),
  "/observability": () => import("./pages/Observability"),
  "/fees": () => import("./pages/Fees"),
  "/hash": () => import("./pages/Balance"),
  "/snapshot": () => import("./pages/Snapshot"),
};

function preloadRoute(to: string) {
  return ROUTE_PRELOADERS[to]?.().catch(() => undefined);
}
import "./features.css";
import "./blocks.css";
import "./observatory.css";
import "./polish.css";

// The Bloch sphere — one qubit, every state. Canonical protocol mark,
// self-theming via the brand tokens.
export const Logo = () => (
  <svg className="logo" viewBox="0 0 26 26" fill="none" aria-label="Bloch Protocol">
    <circle cx="13" cy="13" r="11.2" stroke="var(--brass)" strokeWidth="1.5" />
    <ellipse cx="13" cy="13" rx="11.2" ry="4.2" stroke="var(--brass)" strokeWidth="1.1" opacity="0.55" />
    <line x1="13" y1="13" x2="19.6" y2="7.2" stroke="var(--fg)" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="19.6" cy="7.2" r="2.1" fill="var(--brass)" />
  </svg>
);

/** The lowercase sans-serif wordmark shared with the wallet — "bloch·explorer". */
function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wm-a">bloch</span>
      <span className="wm-dot">·</span>
      <span className="wm-b">explorer</span>
    </span>
  );
}

// The route table and the nav are one declaration.
//
// `nav: true` on a route puts it in the header. That is deliberate: a nav
// entry pointing at a path with no route, or a route nobody can reach from
// the header, are both bugs that used to be possible because NAV and the
// if-chain were two independent lists that had to be kept in step by hand.
//
// `group` places the entry in the mobile drawer, which is grouped the way the
// wallet's sidebar is; `desktop: false` keeps an entry out of the (narrow)
// desktop bar while leaving it in the drawer and the footer.
//
// See `src/routes.tsx` for why this is a table and how literals are protected
// from being shadowed by patterns.
type NavRoute = Route & { nav?: string; group?: string; desktop?: boolean; hint?: string };

const ROUTES: NavRoute[] = [
  { pattern: "/validators/guide", nav: "Validator guide", desktop: false, group: "Network", hint: "validator operations guide", render: () => <ValidatorGuidePage /> },
  { pattern: "/", nav: "Chain", group: "Chain", hint: "head, finality, production", render: () => <G4Dashboard /> },
  { pattern: "/blocks", nav: "Blocks", group: "Chain", hint: "every slot, by epoch", render: () => <G4BlocksPage /> },
  { pattern: "/transactions", nav: "Txs", group: "Chain", hint: "where they landed; each one, when indexed", render: () => <TransactionsPage /> },
  { pattern: "/analytics", desktop: false, nav: "Analytics", group: "Chain", hint: "epochs, proposers, emission", render: () => <AnalyticsPage /> },
  { pattern: "/finality", desktop: false, nav: "Finality", group: "Chain", hint: "the guarantee and its support", render: () => <FinalityPage /> },
  { pattern: "/validators", nav: "Validators", group: "Economy", hint: "the set, its stake, the leak", render: () => <ValidatorsPage /> },
  { pattern: "/supply", nav: "Supply", group: "Economy", hint: "cap, issuance, concentration", render: () => <SupplyPage /> },
  { pattern: "/mempool", nav: "Mempool", group: "Economy", hint: "pending transactions, bytes and admission", render: () => <MempoolPage /> },
  { pattern: "/network", nav: "Network", group: "Network", hint: "RPC nodes, build identities and API", render: () => <NetworkPage /> },
  { pattern: "/observability", desktop: false, nav: "Observability", group: "Network", hint: "Grafana, Prometheus and validator hosts", render: () => <ObservabilityPage /> },
  { pattern: "/fees", desktop: false, nav: "Fees", group: "Economy", hint: "the fee market and the mempool", render: () => <FeesPage /> },
  // `/hash/<64 hex>` is the canonical name of an eUTXO-set entry, and every
  // other identifier a person can paste redirects into it. `/balance…` are the
  // old URLs, kept resolving rather than 404'd: a permalink that stops working
  // is how a reader concludes the balance is gone.
  { pattern: "/hash", desktop: false, nav: "Balance", group: "Lookup", hint: "an entry in the unspent set", render: () => <BalancePage /> },
  { pattern: "/snapshot", nav: "Snapshot", group: "Lookup", desktop: false, hint: "the Genesis-3 handover", render: () => <SnapshotPage /> },
  { pattern: "/balance", render: () => <BalancePage /> },
  {
    pattern: "/hash/:q",
    render: (p) => <HashPage q={p.q} />,
    key: (p) => "h" + p.q,
  },
  {
    pattern: "/balance/:h",
    render: (p) => <HashPage q={p.h} />,
    key: (p) => "h" + p.h,
  },
  // An OUTPOINT, not a transaction: this chain indexes nothing by txid, so
  // there is no /tx/:id to offer and pretending otherwise would promise a
  // lookup `gettransaction` refuses by design.
  {
    pattern: "/outpoint/:txid/:vout",
    render: (p) => <OutpointPage txid={p.txid.toLowerCase()} vout={Number(p.vout)} />,
    guard: (p) => /^[0-9a-f]{64}$/i.test(p.txid) && /^\d+$/.test(p.vout),
    key: (p) => "o" + p.txid + p.vout,
  },
  // No "must come before /validators/:index" comment here: match() tries every
  // literal before any pattern, so this is safe wherever it sits. See routes.tsx.
  { pattern: "/validators/queues", render: () => <ValidatorQueuesPage /> },
  {
    pattern: "/validators/:index",
    render: (p) => <ValidatorDetailPage index={Number(p.index)} />,
    guard: (p) => /^\d+$/.test(p.index),
    key: (p) => "v" + p.index,
  },
  {
    pattern: "/blocks/:from",
    render: (p) => <G4BlocksPage from={Number(p.from)} />,
    guard: (p) => /^\d+$/.test(p.from),
    key: (p) => "r" + p.from,
  },
  // One epoch: its 32 slots, who proposed them, and what the epoch carried.
  {
    pattern: "/epoch/:e",
    render: (p) => <EpochPage epoch={Number(p.e)} />,
    guard: (p) => /^\d+$/.test(p.e),
    key: (p) => "e" + p.e,
  },
  // By block id rather than by slot. The only way to reach a block fork choice
  // did not select: getblockbyslot resolves through the canonical chain and
  // cannot return an orphan; getblockbyid can.
  {
    pattern: "/block/:id",
    render: (p) => <G4BlockPage blockId={p.id} />,
    key: (p) => "b" + p.id,
  },
  // Where a transaction hash lands. Not a 404 — see pages/TxAnswer for why a
  // 404 and a fake "found" are both worse answers than the explanation.
  { pattern: "/tx", render: () => <TxAnswerPage /> },
  {
    pattern: "/tx/:h",
    render: (p) => <TxAnswerPage hash={p.h} />,
    key: (p) => "t" + p.h,
  },
  // The colon form, `/outpoint/<txid>:<vout>`, which is what the search box
  // emits. Same page as the two-segment form above — one outpoint should not
  // have two different-looking pages just because it has two URL spellings.
  {
    pattern: "/outpoint/:op",
    render: (p) => {
      const [txid, vout] = p.op.split(":");
      return <OutpointPage txid={txid.toLowerCase()} vout={Number(vout) || 0} />;
    },
    guard: (p) => /^[0-9a-f]{64}(:\d+)?$/i.test(p.op),
    key: (p) => "o" + p.op,
  },
  {
    pattern: "/slot/:s",
    render: (p) => <G4BlockPage slot={Number(p.s)} />,
    guard: (p) => /^\d+$/.test(p.s),
    key: (p) => "s" + p.s,
  },
];

const NAV = ROUTES.filter((r) => r.nav).map((r) => ({
  to: r.pattern,
  label: r.nav!,
  group: r.group ?? "Chain",
  desktop: r.desktop !== false,
  hint: r.hint,
}));
const GROUPS = [...new Set(NAV.map((n) => n.group))];

function renderRoute(path: string) {
  const hit = match(ROUTES, path);
  if (hit) {
    const el = hit.route.render(hit.params);
    const k = hit.route.key ? hit.route.key(hit.params) : hit.route.pattern;
    return <Fragment key={k}>{el}</Fragment>;
  }

  // Genesis-3 routes are gone, not broken-on-purpose: this explorer is the
  // proof-of-stake chain now. The state proof of work ended in is published
  // whole on /snapshot, which is what anyone following an old link is
  // actually after.
  return (
    <div className="container">
      <div className="card" style={{ marginTop: 24 }}>
        <h1 className="page-title">Nothing at that address</h1>
        <p className="page-lede">
          No route for <code>{path}</code>. This explorer serves Genesis-4, the proof-of-stake
          chain. If you came looking for Genesis-3 — the proof-of-work era that ended at height
          39,918 — its terminal state is published in full on the{" "}
          <Link to="/snapshot">snapshot page</Link>.
        </p>
      </div>
    </div>
  );
}

// ─── the head pulse ─────────────────────────────────────────────────────────
//
// One cheap `getchaininfo` through the edge every 20 s, shared by the chip in
// the topbar and the status line in the footer. Through `/rpc`, never a
// validator: the node RPC has no auth or rate limiting and shares a thread
// with consensus; the edge caches the head for 3 s and coalesces every tab.
const PULSE_MS = 20_000;

interface Pulse {
  head: G4Head | null;
  corro: G4Corroboration | null;
  err: string | null;
  at: number | null;
}

function useHeadPulse(): Pulse {
  const [p, setP] = useState<Pulse>({ head: null, corro: null, err: null, at: null });
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const reading = await g4HeadWithMeta();
        if (!stop) setP({ head: reading.result, corro: reading.corroboration, err: null, at: Date.now() });
      } catch (e: any) {
        if (!stop) setP((prev) => ({ ...prev, err: String(e?.message ?? e) }));
      }
    };
    const teardown = pollWhileVisible(tick, PULSE_MS);
    return () => {
      stop = true;
      teardown();
    };
  }, []);
  return p;
}

function levelDot(p: Pulse): string {
  if (p.err && !p.head) return "stale";
  if (!p.corro) return "";
  if (p.corro.level === "final" || p.corro.level === "corroborated") return "live";
  if (p.corro.level === "node_local") return "blue";
  return "warn";
}

/** The chain-head chip: live slot and height, with a dot that means what it says. */
function HeadChip({ p }: { p: Pulse }) {
  const title = p.err && !p.head
    ? `The edge did not answer: ${p.err}`
    : p.corro
      ? `Head read through the explorer edge. Corroboration: ${p.corro.level}${
          p.corro.archival_witnesses ? ` (${p.corro.archival_witnesses}/${p.corro.of} archivals)` : ""
        }.`
      : "Reading the head…";
  return (
    <Link to="/" className="chip chip-head" aria-label="Chain head" title={title}>
      <span className={"dot " + levelDot(p)} />
      {p.head ? (
        <>
          <span className="chip-k">slot</span>
          <b>{fmtInt(p.head.slot)}</b>
        </>
      ) : (
        <span>{p.err ? "edge down" : "reading…"}</span>
      )}
    </Link>
  );
}

function ThemeToggle() {
  const t = useTheme();
  return (
    <button
      className="icon-btn"
      type="button"
      onClick={() => toggleTheme()}
      aria-label={t === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
      title={t === "dark" ? "Light theme" : "Dark theme"}
    >
      {t === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/** The mobile drawer — the wallet's grouped sidebar, opened from the hamburger. */
function Drawer({
  open,
  onClose,
  path,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  path: string;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = oldOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open, onClose, returnFocusRef]);
  const isActive = (to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`));
  return (
    <div className={"drawer" + (open ? " open" : "")} aria-hidden={!open}>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside id="site-drawer" ref={panelRef} className="drawer-panel" role="dialog" aria-modal="true" aria-label="Explorer sections">
        <div className="drawer-head">
          <Link to="/" className="brand" onClick={onClose}>
            <Logo />
            <span className="brand-name">
              <Wordmark />
              <span className="brand-sub">post-quantum · proof of stake</span>
            </span>
          </Link>
          <button ref={closeRef} className="icon-btn" type="button" aria-label="Close menu" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        <nav className="drawer-nav">
          {GROUPS.map((g) => (
            <div className="nav-group" key={g}>
              <div className="nav-group-label">{g}</div>
              {NAV.filter((n) => n.group === g).map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  className={"nav-item" + (isActive(n.to) ? " active" : "")}
                  onClick={onClose}
                  onPointerDown={() => void preloadRoute(n.to)}
                  onFocus={() => void preloadRoute(n.to)}
                >
                  <span>{n.label}</span>
                  {n.hint && <small>{n.hint}</small>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="drawer-foot">
          Genesis-4 · 64 validators · 30 s slots
          <br />
          by <a href="https://posternlabs.com" rel="noopener">postern · labs</a>
        </div>
      </aside>
    </div>
  );
}

/** Where the numbers on this site come from, and how well they were checked. */
function RpcStatus({ p }: { p: Pulse }) {
  const c = p.corro;
  return (
    <div className="rpc-status" title="Reads go to the archival peers through this site's own edge, never to a validator: the node RPC has no auth or rate limiting and shares a thread with consensus.">
      <span className={"dot " + levelDot(p)} />
      {p.head ? (
        <span>
          Reading Genesis-4 through <code>/rpc</code> — two keyless archivals, edge-cached on
          immutability
          {c ? (
            <>
              {" "}
              · corroboration <code>{c.level}</code>
              {c.archival_witnesses !== undefined && c.of ? (
                <> · {c.archival_witnesses}/{c.of} archivals</>
              ) : null}
              {c.witness?.available && typeof c.witness.age_ms === "number" ? (
                <> · fleet witness {Math.round(c.witness.age_ms / 1000)}s old</>
              ) : c.witness && !c.witness.available ? (
                <> · no fleet witness</>
              ) : null}
            </>
          ) : null}
          {p.at ? <> · head slot {fmtInt(p.head.slot)}</> : null}
        </span>
      ) : p.err ? (
        <span>
          The explorer edge on <code>/rpc</code> did not answer ({p.err}). That is this site's path
          to the chain, not the chain.
        </span>
      ) : (
        <span>Reading the head…</span>
      )}
    </div>
  );
}

export function App() {
  const { path } = useRouter();
  const [drawer, setDrawer] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const previousPath = useRef(path);
  const pulse = useHeadPulse();
  const isActive = (to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`));
  const closeDrawer = useCallback(() => setDrawer(false), []);

  // Close the drawer on navigation, and let ⌘K / Ctrl-K / "/" reach the search
  // box from anywhere — the one keyboard habit every explorer user has.
  useEffect(() => {
    setDrawer(false);
    if (previousPath.current !== path) {
      previousPath.current = path;
      const activeRoute = NAV.find((n) => n.to === "/" ? path === "/" : path === n.to || path.startsWith(`${n.to}/`));
      document.title = `${activeRoute?.label ?? "Explorer"} · Bloch`;
      window.requestAnimationFrame(() => document.getElementById("main")?.focus({ preventScroll: true }));
    }
  }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
      if (!el) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        el.focus();
        el.select();
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        el.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="container">
          <div className="topbar-inner">
            <button
              ref={menuRef}
              className="icon-btn nav-toggle"
              type="button"
              aria-label="Menu"
              aria-expanded={drawer}
              aria-controls="site-drawer"
              onClick={() => setDrawer(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
            <Link to="/" className="brand">
              <Logo />
              <span className="brand-name">
                <Wordmark />
                <span className="brand-sub">genesis-4 · proof of stake</span>
              </span>
            </Link>
            <nav className="mainnav" aria-label="Sections">
              {NAV.filter((n) => n.desktop).map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  className={isActive(n.to) ? "active" : ""}
                  onMouseEnter={() => void preloadRoute(n.to)}
                  onFocus={() => void preloadRoute(n.to)}
                  onPointerDown={() => void preloadRoute(n.to)}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <G4Search />
            <div className="topbar-tools">
              <HeadChip p={pulse} />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <Drawer open={drawer} onClose={closeDrawer} path={path} returnFocusRef={menuRef} />

      <main id="main" tabIndex={-1}>
        <RouteBoundary key={path}>
          <Suspense fallback={
            <div className="route-loading" role="status" aria-live="polite" aria-label="Loading explorer view">
              <div className="route-loading-inner" aria-hidden="true">
                <span>Loading explorer data…</span>
                <i /><i /><i />
              </div>
            </div>
          }>
            {renderRoute(path)}
          </Suspense>
        </RouteBoundary>
      </main>

      <footer className="foot">
        <div className="container">
          <div className="foot-lockup">
            <span className="foot-brand">
              <Logo />
              <Wordmark />
            </span>
            <span className="foot-tagline">
              by <a href="https://posternlabs.com" rel="noopener">postern · labs</a> · nothing here is
              investment advice
            </span>
          </div>
          <div className="foot-body">
            Independent reference explorer for <strong>Bloch Genesis-4</strong> — a post-quantum
            proof-of-stake chain, 64 genesis validators, 30-second slots, finality by epoch. It
            opened carrying every balance from Genesis-3, the proof-of-work era that ended at height
            39,918; that handover is published in full on the <Link to="/snapshot">snapshot</Link>.
            Not an official service; Bloch is ownerless/neutral. Integer satoshis are the source of
            truth (1 BLOCH = 1e8 sat); “bloch” values are display-only. BLCH is neutral native gas,
            never a value or investment claim.
          </div>
          <div className="foot-links">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to}>{n.label}</Link>
            ))}
            <a href="/api/v1/capabilities" rel="noopener">REST API</a>
            <a href="https://posternlabs.com" rel="noopener">posternlabs.com ↗</a>
          </div>
          <RpcStatus p={pulse} />
        </div>
      </footer>
    </div>
  );
}
