// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect } from "react";
import onboardingHtml from "../data/validatorOnboarding.html?raw";
import { Link } from "../lib/router";
import "../validator-guide.css";
import { ValidatorAdmissionStatus } from "../components/ValidatorAdmissionStatus";

export function ValidatorGuidePage() {
  useEffect(() => {
    const before = document.title;
    document.title = "Validator guide · Bloch";
    return () => { document.title = before; };
  }, []);
  return <article className="container validator-guide" lang="en">
    <header className="guide-heading">
      <span className="eyebrow">GENESIS-4 / OPERATIONS GUIDE</span>
      <h1>How to run a Bloch validator</h1>
      <p>Installation, identity, synchronization and maintenance with the signed validator release.</p>
      <p className="guide-date">Reviewed on October 1, 2026. Release and qualification records are timestamped observations.</p>
      <div className="guide-actions"><a href="/docs/validator-onboarding.md" download>Download guide (.md)</a><Link to="/validators">View validators →</Link><Link to="/validators/queues">View queues →</Link></div>
    </header>
    <ValidatorAdmissionStatus />
    <section className="guide-section" id="delegation-preview" aria-label="Funded delegation preview">
      <h2>Funded delegation — rescheduled to October 4</h2>
      <p><strong>Qualification blocked; replacement preview verification is in progress.</strong> The complete CLI/RPC rehearsal failed its finality-lag check before mature withdrawal. Postponing activation does not resolve that failure. Mainnet rollout remains blocked on the complete lifecycle rehearsal and coordinated network readiness.</p>
      <p>The new candidate schedules delegation at <strong>epoch 4669, slot 149408</strong>: October 4, 2026 at <strong>18:35:19.962 UTC</strong> (15:35:19.962 in Brasília), the first epoch boundary after 72 hours from the operator’s request.</p>
      <p>The <a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/releases/tag/funded-delegation-epoch-4528-preview">epoch-4528 preview is superseded</a> and must not be installed. Its fixed activation date cannot be changed through configuration. Its signed assets remain available only as historical evidence.</p>
      <p>Two independent builds of the replacement match. Historical replay of the new executable is in progress; its signed preview will be linked here after verification. No production validator has been migrated by this release workflow.</p>
      <p>The delegated-principal ceiling remains 500,000,000 BLCH per validator. The requested 5% operator commission requires separate finalized transactions after activation.</p>
    </section>
    <section className="guide-section" aria-label="Validator upgrade release">
      <h2>September 30 release with checkpoint 3328</h2>
      <p>This distribution pairs checkpoint 3328 with the signed Linux x86-64 binary from commit <code>4d4c5075872c622fdd26aa418a9d249ec95fbcea</code>. The executable is byte-identical to September 24; no consensus change is introduced. Existing operators must preserve their chain data, keys, command-line arguments and slashing-protection records.</p>
      <div className="guide-actions"><a href="/releases/2026-09-30/bloch-pos" download>Download signed binary</a><a href="/releases/2026-09-30/README.md">Installation and verification instructions</a></div>
      <ul>
        <li><a href="/releases/2026-09-30/SHA256SUMS">Signed checksum manifest</a> · <a href="/releases/2026-09-30/SHA256SUMS.minisig" download>Minisign signature</a> · <a href="/releases/2026-09-30/bloch-release-20260922.pub" download>Minisign public key</a></li>
        <li><a href="/releases/2026-09-30/BUILD-INFO">Build provenance</a> · <a href="/releases/2026-09-30/release.json">Release metadata</a> · <a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/tree/4d4c5075872c622fdd26aa418a9d249ec95fbcea">Pinned source</a></li>
      </ul>
      <p>Expected SHA-256: <code>fb8a65cbd9721d794bd4c2151b50d82d85a7df2299d59d7bad44a7635c30b46a</code>.</p>
      <p>Before restarting, verify the signer-set pin required by <code>--ws-signer-set-sha3</code>. After replay, allow the two-epoch doppelganger observation before expecting validator activation. See the upgrade instructions for the complete checks.</p>
      <p><a href="/releases/2026-09-24/README.md">Original signed binary release — September 24</a></p>
    </section>
    <section className="guide-section" aria-label="Start a new validator">
      <h2>Start a new validator</h2>
      <p>Download the verified Linux release, synchronize an observer, prepare your identity offline, then submit a reviewed deposit through your own node. You need at least 25,000 BLCH plus fees in eligible native outputs.</p>
      <div className="guide-actions"><a href="/docs/validator-onboarding.md">Complete onboarding instructions →</a><a href="/downloads/prepare-node.sh" download>Download node preparation script</a></div>
      <ul>
        <li><a href="/releases/2026-09-30/bloch-pos" download>Linux x86_64 executable</a> · <a href="/releases/2026-09-14/mainnet.manifest" download>Genesis</a> · <a href="/releases/2026-09-14/carryover.tsv.gz" download>Carryover</a></li>
        <li><a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/tree/4d4c5075872c622fdd26aa418a9d249ec95fbcea">Build source</a> · <a href="/releases/2026-09-30/SHA256SUMS">Signed SHA-256 checksums</a> · <a href="/releases/2026-09-30/release.json">Release metadata</a></li>
        <li><a href="/downloads/prepare-identity.sh" download>Manual offline identity helper</a> · <a href="/downloads/deposit-submit.py" download>Local deposit preflight and submission helper</a></li>
      </ul>
      <p>The identity helper invokes the existing utility with its devnet/throwaway label; review its custody limitations in the onboarding instructions. Production keys must be handled by their human custodians outside agent sessions. Full mainnet withdrawal-and-spend qualification is still pending.</p>
    </section>
    <div className="guide-section onboarding-layout" dangerouslySetInnerHTML={{ __html: onboardingHtml }} />
    <section className="guide-section" id="confianca" aria-label="Signed checkpoint"><h2>Public checkpoint — epoch 3328</h2><p>Exchange observers need no validator key or bond. This historical envelope retains its three valid signatures and original bytes. All three keys were used on the same Mac; independent custody has not been established. The operator authorized publication of this existing checkpoint on September 30. Review <a href="/checkpoints/epoch-3328/verification.json">the verification record and its limits</a> before choosing this trust anchor.</p><p>Renew before epoch 5344, October 12, 2026 at 06:35:19.962 UTC. The installer checks expiry and passes the required signer-set fingerprint. This release does not claim a new full mainnet synchronization test.</p><p><a href="/docs/renovar-checkpoint.md">Instructions to generate and sign a future checkpoint (.md)</a></p><ul>{["ws-envelope.bin", "signer-set.bin", "checkpoint.bin", "checkpoint.json", "verification.json", "SHA256SUMS.txt"].map(name => <li key={name}><a href={"/checkpoints/epoch-3328/" + name} download>{name}</a></li>)}</ul></section>
    <section className="guide-section" aria-label="Technical documentation"><h2>Release technical documentation</h2><ul>
      <li><a href="/docs/funded-validator-admission.md">Funded admission and offline signing</a></li>
      <li><a href="/docs/validator-exit-and-withdrawal.md">ADR-041: exit and withdrawal</a></li>
      <li><a href="/docs/validator-key-custody.md">Key preparation and custody</a></li>
    </ul></section>
  </article>;
}
