# Remaining validator qualification

Updated September 15, 2026 (UTC). Technical admission is active at epoch 2884.
The deployed fleet audit recorded 64 upgraded, qualified validators. A new
keyless observer synchronized from empty data using the published checkpoint
and public bootnodes, then matched the fleet's block and state roots.
[Deployment evidence](/releases/2026-09-14/onboarding-verification.json).

The September 14 source-level qualification rerun passed 27 key tests,
four offline CLI tests, the withdrawal-guard control and all eight mutation
checks, and the isolated lifecycle, invalid-mempool and RANDAO-renewal
rehearsals. The lifecycle test includes an actual TransferV2 payout spend
and matching replay state. It uses disposable identities and simulated
epochs; it is not a mainnet transaction or an independent-process transport
test. [Commands, scope and retained-log hashes](/releases/2026-09-14/qualification-verification.json).

Four additional terminal tests use a fake executable, with no real key
generation. They verify that the identity helper suppresses shell tracing
and password echo, avoids exporting inherited password variables, restores
terminal settings, preserves existing identities, and refuses short
passwords and malformed public metadata. These checks do not qualify the
underlying key generator or its production custody ceremony.

These results do not complete the controlled mainnet lifecycle or constitute
an independent production key-generation review.

## Controlled mainnet lifecycle

Use a separate, explicitly designated funded test identity. Do not exit an
existing fleet validator to substitute for a funded-registration test.

1. The funding owner supplies public input references (`txid:vout:value`),
   the suite-enveloped funding and validator public keys, the validator's
   RANDAO commitment, and the withdrawal and change credentials. The owner
   confirms at least 25,000 BLCH plus fees in eligible native UTXOs. No
   private keys, passwords or RANDAO seeds belong in the evidence record.
2. Prepare and inspect the deposit using the [onboarding commands](/docs/validator-onboarding.md).
   The human custodians sign the funding and validator roles offline. Record
   the transaction ID, inclusion block, finalized checkpoint and assigned
   validator index. Submission acceptance alone is not registration proof.
3. Observe activation after finality, the eight-epoch minimum delay and churn
   limits. Record actual proposed blocks and attestations from the new
   identity, together with matching block/state roots on another node.
4. After the operator authorizes this test identity's exit, its custodian
   signs `validator-lifecycle exit --dir KEYSTORE_DIR --epoch INCLUSION_EPOCH
   --out exit.hex` offline. The signature names the exact inclusion epoch;
   re-sign if that epoch expires. Record the included exit transaction and
   the registry's `exit_epoch` and `withdrawable_epoch`.
5. Wait for the actual registry maturity. For an ordinary voluntary exit
   included at epoch E, the release sets `exit_epoch = E + 32` and
   `withdrawable_epoch = E + 32 + 2048`. At 16 minutes per epoch, that is
   23 days, 2 hours and 40 minutes after the start of E. This excludes the
   preceding deposit/activation period and subsequent inclusion/finality
   time. Slashing can extend the lock; read the registry again before use.
6. Observe the automatic withdrawal, or prepare the permissionless encoding
   with `validator-lifecycle withdraw --validator INDEX --out withdraw.hex`
   if still needed. Submission goes through the operator's own node.
   Verify the settled payout's outpoint, value and committed withdrawal
   credential. A duplicate withdrawal must not pay again.
7. The withdrawal custodian uses the [separate offline payout tool](/docs/validator-payout-offline.md)
   to prepare, inspect and sign a TransferV2 spending that payout. Record
   the transaction, inclusion block and finality evidence; confirm the old
   payout is spent and the intended new output exists on two nodes. Only
   then mark the full mainnet lifecycle complete. Qualify the chosen wallet
   or offline encoder before this step: it must emit TransferV2 (tag `0x06`).
   The release's `bloch-pos submit-tx` command constructs the older Transfer
   format and is not a substitute for this specific TransferV2 check.

Do not compress production epoch delays. Isolated devnet rehearsals can
exercise this sequence quickly, but cannot replace its mainnet evidence.

## Production key-generation review

The existing `keygen` utility retains its devnet/throwaway designation.
The interactive helper does not change that qualification status.
Custodians must generate production material in their own private offline
environment under the [custody requirements](/docs/validator-key-custody.md).

The release review should retain the pinned source and executable hashes,
build provenance, OS randomness path, hybrid signing/verification tests,
sealed-file and RANDAO recovery tests, wrong-passphrase and tampering
rejections, filesystem-permission checks, and overwrite/running-node guards.
An independent reviewer must assess the production ceremony, backup recovery
and secret exposure paths. Record that review and its scope before changing
the production qualification claim. Passing the repository tests is useful
engineering evidence, not an independent audit.
