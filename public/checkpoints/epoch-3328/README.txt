Bloch Genesis-4 checkpoint 3328 — historical signatures, operator-authorized publication

This package preserves the checkpoint bytes, issued_at, signer set, historical
partials and envelope. Offline verification on 2026-09-30 accepted all three
signatures and reported FRESH against previously observed epoch 4295.

The operator explicitly authorized use of checkpoint 3328 on 2026-09-30 after
the historical custody limitation was explained. PUBLICATION-DECISION-20260930.json
records that scope. PUBLICATION-HOLD remains unchanged as the historical record.
Independent custody is NOT verified; no new signatures were produced. Do not
present this release as an independently signed ceremony.

Run: python3 check-review.py
This checks retained package integrity and the reported authorization scope.
It does not perform a fresh cryptographic verification or a network query.
Run with --require-independent-publication to require independent custody;
this package deliberately refuses that claim.

Reverify the envelope using a trusted compatible binary and an independently
obtained genesis manifest. Refresh the current epoch before installation.
Signer-set SHA3-256 pin:
bccb7c5ee127f806ac7da69a6dfab0a0b1c3d2750d6224bbfb652baa3322d627
WS digest:
f4f067929ee881f671df54a5849edec4106c712f28b2286ab1a7fc58e587fbc0

The byte hashes and reports published together do not independently authenticate
the signer identities or prove canonical ancestry. See verification.json.
