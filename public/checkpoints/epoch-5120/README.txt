Bloch Genesis-4 weak-subjectivity checkpoint — epoch 5120

Signed on 2026-10-09 with the three keys of signer set 1 (sha3 bccb7c5e…):
index 0 Tiago, index 1 Alexandre, index 2 Bruno.
CUSTODY: as with epoch 3328, all three keys were used on the same machine by the operator.
Independent custody is NOT verified; do not present this as an independently signed ceremony.
Quorum 2-of-3 with >=1 external; 3 of 3 signed.
Boundary slot 163839, block root 9e5601c3c761853b7f7a71bb90215a5eb707b14e2da090fd055afa0f4d6a3a1f.
Derived from three nodes run by the same operator (two archivals and one validator), which agreed byte for byte.

WS DIGEST  9d70b55b98d692184d0e190ba2b92e0ffe9915e2364f5aeb417b54aef0f754d9

Accepted by ws::verify_envelope against the live chain at epoch 5148 (FRESH, age 28 of 2016).
Usable until about epoch 7136. Supersedes epoch-3328 (expires about epoch 5344) for new nodes.

Start a node:  bloch-pos run ... --ws-checkpoint ws-envelope.bin --ws-signer-set signer-set.bin
Verify first:  bloch-pos ws-verify --envelope ws-envelope.bin --signer-set signer-set.bin --genesis <manifest>
Compare the digest above with a second, independent channel before trusting it.
