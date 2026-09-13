# RPC recovery and activation compatibility — 2026-09-13

The public `/rpc` request timed out after 25 seconds while both archival
observers were synchronized. A later response completed in 2.9 seconds but
used validator 0 at slot 79,686 as its fleet witness for archival slot 88,384.
This establishes an intermittent public-path failure and a stale witness; it
does not prove that the stale witness alone caused every timeout.

At 14:35 UTC the server 139.84.201.52 public proxy was switched from local
16400 (validator 0) to local 16407 (validator 7). The replacement was checked
against the approved finalized checkpoint before and after the switch. No
validator was restarted. Six subsequent public head reads completed in
1.48–2.39 seconds, with advancing height and current witnesses. This is a
bounded recovery observation, not a guarantee against future failures.

The client previously advertised a fallback but its transport only used
`/rpc`. It now reserves part of its 25-second total budget for the existing
Postern fallback after a transport failure, and cools the primary for one
minute. Valid RPC errors, including throttling and divergence, do not trigger
failover. Cancellation stops the request. The fallback's different quorum
contract is explicitly labelled uncorroborated instead of being promoted to
archival certification. Stale fleet witnesses are rejected before they can
certify the archival plane or invalidate its cache lineage.

The activation binary uses the exhaustive method registry, not the separate
branch's `RPC_SURFACE` table. Cross-repository verification now checks that
registry against the dispatcher. `getvalidatoradmission` and
`getvalidatorbykey` are optional, node-local reads during the mixed-version
rollout. `getsupply` and `getstakedistribution` remain advertised as optional
because they are absent from this binary lineage.

Validation: 89 tests passed, none skipped, with `BLOCH_NODE_RPC_RS` pointing
to release e7261e6; TypeScript and the production build passed. Deployment of
this source requires the Cloudflare account login; the server proxy repair
is already applied independently.
