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
      <p>Installation, identity, synchronization and maintenance with the new validator binary.</p>
      <p className="guide-date">Reviewed on September 24, 2026. Release and qualification records are timestamped observations.</p>
      <div className="guide-actions"><a href="/docs/validator-onboarding.md" download>Download guide (.md)</a><Link to="/validators">View validators →</Link><Link to="/validators/queues">View queues →</Link></div>
    </header>
    <ValidatorAdmissionStatus />
    <section className="guide-section" aria-label="Validator upgrade release">
      <h2>September 24 validator upgrade</h2>
      <p>Existing synchronized Genesis-4 validators can upgrade to the signed Linux x86-64 binary built from commit <code>4d4c5075872c622fdd26aa418a9d249ec95fbcea</code>. Preserve the current command-line arguments, validator key environment, chain data and slashing-protection records. This package does not contain keys or a current bootstrap checkpoint.</p>
      <div className="guide-actions"><a href="/releases/2026-09-24/bloch-pos" download>Download signed binary</a><a href="/releases/2026-09-24/README.md">Upgrade and verification instructions</a></div>
      <ul>
        <li><a href="/releases/2026-09-24/SHA256SUMS">Signed checksum manifest</a> · <a href="/releases/2026-09-24/SHA256SUMS.minisig" download>Minisign signature</a> · <a href="/releases/2026-09-24/bloch-release-20260922.pub" download>Minisign public key</a></li>
        <li><a href="/releases/2026-09-24/BUILD-INFO">Build provenance</a> · <a href="/releases/2026-09-24/release.json">Release metadata</a> · <a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/tree/main/releases/bloch-pos-2026-09-24">Repository copy</a></li>
      </ul>
      <p>Expected SHA-256: <code>fb8a65cbd9721d794bd4c2151b50d82d85a7df2299d59d7bad44a7635c30b46a</code>.</p>
      <p>Before restarting, verify the signer-set pin required by <code>--ws-signer-set-sha3</code>. After replay, allow the two-epoch doppelganger observation before expecting validator activation. See the upgrade instructions for the complete checks.</p>
      <p><a href="/releases/2026-09-22/README.md">Previous signed release — September 22</a></p>
    </section>
    <section className="guide-section" aria-label="Start a new validator">
      <h2>Start a new validator</h2>
      <p>Download the verified Linux release, synchronize an observer, prepare your identity offline, then submit a reviewed deposit through your own node. You need at least 25,000 BLCH plus fees in eligible native outputs.</p>
      <div className="guide-actions"><a href="/docs/validator-onboarding.md">Complete onboarding instructions →</a><a href="/downloads/prepare-node.sh" download>Download node preparation script</a></div>
      <ul>
        <li><a href="/releases/2026-09-14/bloch-pos-linux-x86_64" download>Linux x86_64 executable</a> · <a href="/releases/2026-09-14/mainnet.manifest" download>Genesis</a> · <a href="/releases/2026-09-14/carryover.tsv.gz" download>Carryover</a></li>
        <li><a href="/releases/2026-09-14/bloch-pos-source.tar.gz" download>Build source</a> · <a href="/releases/2026-09-14/SHA256SUMS.txt">SHA-256 checksums</a> · <a href="/releases/2026-09-14/release.json">Release metadata</a></li>
        <li><a href="/downloads/prepare-identity.sh" download>Manual offline identity helper</a> · <a href="/downloads/deposit-submit.py" download>Local deposit preflight and submission helper</a></li>
      </ul>
      <p>The identity helper invokes the existing utility with its devnet/throwaway label; review its custody limitations in the onboarding instructions. Production keys must be handled by their human custodians outside agent sessions. Full mainnet withdrawal-and-spend qualification is still pending.</p>
    </section>
    <div className="guide-section onboarding-layout" dangerouslySetInnerHTML={{ __html: onboardingHtml }} />
    <section className="guide-section" id="confianca" aria-label="Signed checkpoint"><h2>Public checkpoint — epoch 1536</h2><p><a href="/docs/observer-and-admission-status-2026-09-15.md">Observer requirements, ceremony date and release evidence</a>. Exchange observers need no validator key or bond.</p><p><a href="/docs/renovar-checkpoint.md">Full instructions to generate and sign the next checkpoint (.md)</a></p><p>Three valid signatures. The operator reports the ceremony took place on September 4, 2026; signer identity and independence are not independently attested by the verification record. Renew before epoch 3552, on September 22, 2026 at 08:43:19 UTC. Read the checkpoint instructions before use.</p><ul>{["ws-envelope.bin", "signer-set.bin", "checkpoint.bin", "checkpoint.json", "verification.json", "SHA256SUMS.txt"].map(name => <li key={name}><a href={"/checkpoints/epoch-1536/" + name} download>{name}</a></li>)}</ul></section>
    <section className="guide-section" aria-label="Technical documentation"><h2>Release technical documentation</h2><ul>
      <li><a href="/docs/funded-validator-admission.md">Funded admission and offline signing</a></li>
      <li><a href="/docs/validator-exit-and-withdrawal.md">ADR-041: exit and withdrawal</a></li>
      <li><a href="/docs/validator-key-custody.md">Key preparation and custody</a></li>
    </ul></section>
  </article>;
}
