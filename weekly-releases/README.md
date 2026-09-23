# Weekly development releases

The same English journal is served at:

- https://posternlabs.com/releases
- https://blochprotocol.io/releases

Release 1 is dated September 16, 2026. `/releases/1` and `/releases/1.json`
are its permanent HTML and JSON records. The development edition number is
independent of the node binary version. No node is upgraded by this service.
Release 2 was editorially reviewed and published early on September 23, 2026.
The archived `release-2.json` records the real publication time and the public
GitHub window beginning at Release 1. The scheduled job will find the edition
already archived and leave it unchanged.

## Weekly publication

Cloudflare Cron runs `0 21 * * WED`: Wednesday at 21:00 UTC / 18:00
America/Sao_Paulo under the current UTC-3 offset. Release 2 is scheduled for
September 23, 2026. This runs in Cloudflare and does not require a local Mac.

The scheduled handler snapshots `roadmap:current`, queries the configured public
GitHub branches for the preceding seven days, archives a numbered edition and
then updates the latest pointer. A repeated run preserves an existing edition.
An interrupted latest-pointer write is repaired on retry. Source errors remain
explicitly unavailable; they are not counted as zero commits. A 100-commit sample
is labelled as truncated, and only eight titles per source are displayed.

GitHub activity is evidence of commits, not successful testing, deployment or
production readiness. Local/unpushed work and repositories without public access
are not visible to the collector. No private repository credentials are installed
in the Worker. As observed during Release 1 collection, only the core main branch
was publicly readable; other sources returned 404. The reviewed engineering
summary incorporates local inspection and retains its own review date.

## Agent handoff and roadmap maintenance

After completing work, the responsible agent must update the relevant track in
`roadmap.json`: current implementation, remaining work, evidence/scope, source,
and the actual `reviewed_on` date. Confirm published claims against deployment
records. A commit or a green unit test must not automatically promote a feature
into `Published`. Update the published-node baseline only after binary publication.

Validate the file and upload **only** the reviewed current manifest:

```sh
node --test test.mjs
npx wrangler kv key put 'roadmap:current' --binding RELEASES --path roadmap.json --remote --config wrangler.jsonc
```

That affects the next scheduled edition. It does not rewrite prior reports.
Do not edit archived `release:*` records to backdate progress. Corrections should
be dated and published explicitly in the next editorial review. The initial
`release-1.json` is retained as a bundled fallback; the archived KV record takes
precedence. Future reports display when engineering status was last reviewed,
so recurring publication cannot silently make stale readiness claims look new.

A schedule can publish a source-activity report without a fresh editorial review;
it cannot inspect an agent's uncommitted local work or certify roadmap completion.
To keep all workstreams current, maintain this handoff as part of each agent's
completion criteria.

When an explicitly requested reviewed edition is published before the weekly
cron, generate it with `node collect-reviewed.mjs`, inspect and test the resulting
`release-2.json`, then upload the roadmap and archive to the remote `RELEASES`
KV namespace. Move `latest` only after both `/releases/2.json` routes serve the
archived record. The public worker has no write route. Do not regenerate or
overwrite an archived edition after the pointer moves.

## Implementation and validation

- `model.mjs`: validated roadmap, date/edition calculation and weekly collector.
- `worker.mjs`: read-only public routes and scheduled publication.
- `render.mjs` / `style.css`: server-rendered accessible page; no client JavaScript.
- `test.mjs`: scheduler, interruption, unavailable-source, escaping and actual
  fetch-handler regressions.
- `wrangler.jsonc`: exact routes, persisted archive binding and weekly trigger.
- `deployment-verification.json`: deployed routes/schedule and source hashes.

Run `node --test test.mjs`, then `npx wrangler deploy --dry-run` before deployment.
Browser qualification covers WebKit at 390, 768 and 1440 pixels, keyboard-focus
styles, native disclosure controls, no horizontal overflow and no script errors.
The menu link is a small independent change in `../validator-guide-site/worker.js`;
it preserves the existing Pages origin and validator guide.

Public requests cannot trigger a publication or modify storage. The archive is
read-only through HTTP. Authentication is supplied through Wrangler outside the
repository. Release source routes do not intercept wallet, RPC or node downloads.

Rollback the Worker version through Cloudflare if required; retain its KV archive.
Cron changes can take several minutes to propagate. Check the configured schedule
and `scheduler:last-success`, not only the publication date in the browser.
