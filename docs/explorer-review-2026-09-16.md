# Explorer review — 2026-09-16

Transaction lookup now requests the receipt directly instead of depending on an
indexer health probe. It distinguishes 404 (not indexed in this snapshot), service
failure, malformed or mismatched receipts, and ambiguous occurrences. A manual
retry and a link to another lookup are available independently of observer status.

Receipt conservation uses exact integer satoshis; missing amounts are no longer
reported as mismatches. Balanced value-transfer receipts show output, validator
stake and fee allocation, with exact amounts and explicitly truncated percentages.
Indexer replay claims are labelled as indexer reports. Search checks cancellation
before navigating after asynchronous responses.

Analytics now shows transaction counts, slot fill and distinct proposers per
epoch, plus sample coverage and snapshot time. Incomplete/unread epochs remain
excluded. Supply failures retain their actual cause instead of claiming every
failure is method-not-supported. Empty blocks do not imply an empty mempool.
Bar charts expose values to keyboard and assistive technology; invalid numerical
samples are excluded, single-point lines remain visible and zero shares have no
painted bar.

Validation: 127 node tests passed, none skipped, against the validator-payout node
RPC registry; production build, fee consistency, TypeScript and diff checks passed.
A WebKit run with deterministic RPC/indexer fixtures checked outage-to-retry,
independent observer status, receipt allocation, new analytics charts, supply
error attribution, 390px horizontal overflow and absence of browser exceptions.
Screenshots are local validation artifacts under /private/tmp/explorer-*.png.
