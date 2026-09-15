# Observer, Phase-A and validator admission status

Updated September 15, 2026. This note updates the earlier status statements about unpublished checkpoints and unarmed admission. Historical specifications and older `main` revisions do not describe the deployed September 14 release.

## Ceremony and checkpoint

**The operator confirms that the signing ceremony took place on September 4, 2026.** This is the operator-reported ceremony date. The published artifact verification occurred on September 14; it is not the ceremony date.

The operator identifies **Alexandre Capua Martginago** and **Bruno Miranda Filetti** as signatories to the September 4 ceremony. These names are operator-provided; their individual public-key fingerprints and institutional roles have not yet been linked in the published evidence. The third signatory has not been identified in this update. No external-auditor role is inferred from either name.

The [epoch-1536 verification record](https://blochl1.com/checkpoints/epoch-1536/verification.json) reports three valid signatures from distinct keys under signer set 1, with a 2-of-3 quorum. Public downloads:

- [Signed envelope](https://blochl1.com/checkpoints/epoch-1536/ws-envelope.bin)
- [Signer set](https://blochl1.com/checkpoints/epoch-1536/signer-set.bin)
- [Checkpoint metadata](https://blochl1.com/checkpoints/epoch-1536/checkpoint.json)
- [SHA-256 checksums](https://blochl1.com/checkpoints/epoch-1536/SHA256SUMS.txt)

Checkpoint digest (SHA3-256):

```text
e329e6c61ccf91e9338d94a1c1c98e4984e92ad770e995b4ce44596edae2b801
```

Signer-set fingerprint (SHA3-256):

```text
bccb7c5ee127f806ac7da69a6dfab0a0b1c3d2750d6224bbfb652baa3322d627
```

**Remaining assurance:** the Phase-A specification names Foundation and Postern custodians plus an external security-audit firm. The artifact’s external-role labels are declarations, not independent attestations of those identities, independence or custody. The verification record also reports an all-zero validator-set-root placeholder accepted by this release. Signature verification and the operator-reported date alone do not prove compliance with the specified custody arrangement or an exchange’s trust policy.

Initial synchronization refuses this checkpoint at epoch **3552**, September 22, 2026 at **08:43:19 UTC**. Renew it before that deadline. Independently authenticate the signer identities, envelope digest and signer-set fingerprint; publishing all of them on one operator’s websites does not create independent corroboration.

## Keyless exchange observers

An observer requires **no validator key, no bond and no validator slashing exposure**. Validator admission is independent of observer bootstrap.

Follow only sections 1–2 of the [installation instructions](https://blochl1.com/docs/validator-onboarding.md); stop after observer synchronization. Do not run validator identity generation or deposit commands for an observer. The preparation script stages the pinned release, genesis files, signed checkpoint and signer set.

The [deployment record](https://blochl1.com/releases/2026-09-14/onboarding-verification.json) reports a keyless process starting from empty data, using public bootnodes, and reaching the live head with matching block/state roots on September 14 at **23:11:43 UTC**. This establishes a tested bootstrap path. It does not independently establish signer custody, an independently operated observer pair, or exchange crediting readiness. Apply the [deposit-crediting requirements](https://blochprotocol.dev/#crediting) before enabling crediting.

## Pinned release and activation

The [September 14 release metadata](https://blochl1.com/releases/2026-09-14/release.json) pins source commit `58da5ce209acb6e293b3b381dfd826dedb8741fd` and activation epoch **2884**, September 14 at **22:35:19 UTC / 19:35:19 Brasília time**. The 20:00 announcement was an onboarding target, not a runtime activation switch.

- [Corresponding source archive](https://blochl1.com/releases/2026-09-14/bloch-pos-source.tar.gz)
- [Linux x86_64 binary](https://blochl1.com/releases/2026-09-14/bloch-pos-linux-x86_64)
- [Release checksums](https://blochl1.com/releases/2026-09-14/SHA256SUMS.txt)

Binary SHA-256:

```text
b3171d1227333284d65c7f60ac925d9e49123908d4c5fcb124ede3f1568a1084
```

An older `main` revision with `FUNDED_VALIDATOR_ADMISSION_ACTIVATION_EPOCH = u64::MAX` remains unarmed. Do not use it as a substitute for the pinned release. There is no runtime option that changes the consensus epoch.

The retained audit records 64 upgraded, qualified validators at **22:59:46 UTC** on September 14 and admission active on both archivals at **22:36:28 UTC**. The fleet audit is after the activation epoch; it does not by itself prove all validators were upgraded before the flag day. It is a timestamped observation, not a current fleet-health guarantee.

## Bonds and withdrawals

The release enables admission and the exit/withdrawal lifecycle at epoch 2884. However, the complete controlled **mainnet deposit → activation → exit → withdrawal → payout-spend qualification remains pending**, as does an independent production key-generation review. A successful deposit is not proof of a tested withdrawal path.

For an ordinary voluntary exit included at epoch E, maturity is E + 32 + 2048: **23 days, 2 hours and 40 minutes after the start of E**, excluding the earlier admission/activation period and later inclusion/finality time. Slashing can extend the lock. Consult the [qualification procedure](https://blochl1.com/docs/validator-qualification.md) before committing funds. No bond or withdrawal workflow is necessary to operate an observer.
