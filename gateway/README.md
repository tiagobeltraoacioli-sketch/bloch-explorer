# Genesis-4 production gateway replacement

## Cold-cache evidence recovery — 2026-09-24

Gateway 2.0.2 refreshes the archival plane before serving a cached,
branch-sensitive read. Cloudflare response caches can survive isolate recycling
while in-memory plane evidence does not. Previously this produced `-32051`
with `not_probed` even when healthy observers and a fleet witness were reachable.
The refresh uses the existing coalescing, deadline, budget and evidence TTL.
A newly observed lineage contradiction invalidates the old cached answer.
Missing or contradictory evidence still fails the strict gateway check.

Regression coverage exercises warm caches in cold isolates, failed evidence
refresh, bounded repeated reads, and finalized block reuse without refetching
the block. Deployment must retain existing gateway variables (`--keep-vars`).
The previous production Worker version is
`b06d2e28-ccfa-451b-88be-183b1b6dc3f1` for rollback.

**Live at https://posternlabs.com/g4rpc since 2026-09-14.** Gateway 2.0.0,
Worker version `b917ff94-c568-477a-bbbf-e4c523e6a974`. See the production record
below; the earlier permission limitation and preview notes are historical.

The gateway preserves the JSON-RPC read surface and signed transaction submission
at `/g4rpc`, while refusing settlement-sensitive reads without two agreeing
archival responses and fresh fleet corroboration. It reuses the explorer's
lineage tracking, weighted request budgets, cache invalidation and upstream
admission limits rather than implementing another consensus-view algorithm.

This is upstream corroboration, not proof of independent operators. Exchange
crediting still requires authenticated bootstrap, independent operation and the
published uninterrupted-finality margin. Node-local tracking and pinned registry
pagination remain explicitly labelled and are not settlement signals.

## Wire contract

- POST JSON-RPC 2.0 with an explicit string, safe integer or null id. Array and
  object params pass through; batches and notifications receive `-32600`.
- CORS preflight is answered locally. Origin, cookies, caller authorization and
  Host are never forwarded to node RPCs. RPC responses are not browser-cacheable.
- Request body: at most 1 MiB, checked while streaming; body deadline: 10 seconds.
  Upstream responses are bounded to 2 MiB, including bodies without a length.
- Read-quorum failure: `-32051`. Critical reads never fall back to one observer
  or stale cache. Read cache behavior/TTLs are disclosed by getcapabilities.
- Broadcast: one configured keyless observer, no cache, no automatic retry and
  no fan-out. Success and node errors, including `-32010`, `-32008` and `-32009`,
  are returned without reinterpretation. This deliberately replaces the old
  all-node fan-out with a single authoritative admission response.
- A broadcast timeout, invalid response, redirect or transport error returns
  `-32052`, `admission_unknown: true`. Reconcile status/outpoints before retrying
  the same bytes; never infer rejection or build a second payment from this error.
- Broadcast limits per isolate: burst 4, sustained 2/s, at most 2 concurrent
  submissions. Other limits reuse the read edge. These are not global account
  limits; configure Cloudflare rate limiting for an account-wide traffic policy.

## Source and checks

`worker.js` is the standalone Worker entry point. `../functions/g4rpc.js` is a
Pages preview adapter. Tests run in the explorer suite, including real read-engine
fixtures for agreement, divergence and single-observer degradation. Injected
broadcast tests cover node error preservation and unknown delivery outcomes.

```
BLOCH_NODE_RPC_RS=/path/to/bloch-sis-pow/crates/bloch-pos-node/src/rpc.rs npm test
npm run build
npx wrangler deploy --config gateway/wrangler.toml --dry-run --outdir /tmp/g4-gateway-build
```

## Production routing and rollback

The inspected apex DNS record points to `posternlabs.pages.dev`. The published
site combines informational pages, wallet assets and downloads. Replacing that
Pages project with this gateway would remove unrelated resources and is not the
cutover strategy. Tunnel configuration does not need to change for a path-scoped
Worker route.

1. With Workers Scripts and Workers Routes access, read and retain all current
   zone routes, the old matching Worker version (if any), and the current Pages
   deployment id. Inspect overlapping route patterns before selecting a route.
2. Deploy `bloch-g4-rpc-v2` without production routes. Test its `/g4rpc` preview:
   capabilities, normal reads, invalid method, CORS and malformed requests.
   Do not send a real payment for a routing smoke test.
3. Attach only the reviewed `posternlabs.com/g4rpc*` route to the new Worker.
   The handler passes unmatched sibling paths through. If an existing broader
   Worker owns such siblings, resolve that overlap before attaching this route.
4. Verify the custom-domain gateway version, quorum error contract and healthy
   reads; verify that homepage, wallet and download paths retain their behavior.
5. Roll back by restoring the prior route target, or deleting only the newly
   created route if none existed. The prior Pages deployment remains available.

The local credential could read DNS/Pages but returned HTTP 403 for Workers
scripts/routes on 2026-09-14. Production cutover requires Workers Scripts Edit
on the account and Workers Routes Edit on the posternlabs.com zone. Never replace
DNS, the whole Pages project or a tunnel to bypass that missing permission.

## Verified preview — 2026-09-14

Source commit: `e9124dd`. Immutable deployment:
`https://1983c432.bloch-explorer.pages.dev/g4rpc`. Preview alias:
`https://rpc-gateway-preview.bloch-explorer.pages.dev/g4rpc`.

109 tests passed, none skipped; frontend build and standalone Worker bundle
generation passed. Live capabilities advertised gateway 2.0.0 and -32051.
Chain-info, block-count and a known-absent outpoint returned corroborated
results. CORS returned 204; an unknown method returned -32601. Submission of
the deliberately invalid byte 0x00 returned the node's exact -32002 decode
refusal. No valid transaction was broadcast.

During validation, a divergent outpoint response was correctly withheld with
-32051; a later request succeeded. This is a point-in-time smoke test, not a
production settlement or independent-operator qualification.

Runtime correction: Workers rejects redirect mode `error`; use `manual` and
reject non-success responses. This behavior is explicit in Cloudflare's
[workerd source](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c++).

See `preview-verification-2026-09-14.json` for retained live results. Production
`posternlabs.com/g4rpc` has not been replaced: the supplied Tunnel credential
was saved locally with mode 0600 and could list healthy tunnels, but Workers
script and route access still returned HTTP 403. No tunnel, DNS record or
existing production Pages deployment was changed.

## Production cutover — 2026-09-14

The previously saved Pages credential gained Workers Scripts/Routes access;
the separate Tunnel credential remained restricted. The standalone Worker was
verified at its workers.dev origin before the new route was created.

- Route: `posternlabs.com/g4rpc*` → `bloch-g4-rpc-v2`.
- Route ID: `0191b8c61a824d428cc5089e3be03424`.
- `request_limit_fail_open: false`, verified through the API.
- Runtime source: `e9124dd`; deployment checkout: `4883d56`.
- Worker version: `b917ff94-c568-477a-bbbf-e4c523e6a974`.

Production capabilities, chain-info, block-count, gettxout, unknown-method
refusal, CORS, query-string and trailing-slash routing passed live checks.
The invalid byte 0x00 returned the node's -32002; no valid payment was sent.
Before/after status and body digests matched for `/`, `/apps/postern/`,
`/dl/stats` and `/g4rpc-other`. `/dl/stats` was already 404 and remains so;
this check does not certify the downloads service. The original Pages
deployment `34bb12bf-dcfe-46ba-89bb-a11446988bd1` remains unchanged.

Rollback: remove only the newly created route above. The original Pages
Function then handles `/g4rpc` again. No DNS, tunnel or legacy Worker was
changed. Local pre-cutover backups are retained in the operator's Documents
directory; the sanitized record is `production-verification-2026-09-14.json`.
