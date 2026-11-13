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
      <p className="guide-date">Upgrade release updated November 13, 2026. Other qualification records retain their original dates.</p>
      <div className="guide-actions"><a href="/docs/validator-onboarding.md" download>Download guide (.md)</a><Link to="/validators">View validators →</Link><Link to="/validators/queues">View queues →</Link></div>
    </header>
    <ValidatorAdmissionStatus />
    <section className="guide-section" aria-label="Validator upgrade release">
      <h2>November 13 mandatory upgrade: required before epoch 8620</h2>
      <p>Signed Linux x86-64 release from commit <code>906336fd35f157dac380523b59dee8a5a325175a</code>. <strong>Every node — validators, observers and exchange nodes — must run it before epoch 8620 (2026-11-17 16:11 UTC).</strong> KES enforcement activates at that epoch as scheduled, and this release arms two follow-up rules of the same fork at the same epoch: the vote slot-epoch binding and the KES first-key floor. A node still on an earlier release can leave the canonical chain from epoch 8620 on. Nothing changes before that epoch. The release includes the November 12 security hardening and a node-local <code>--reject-block-root</code> option for nodes left on the abandoned branch of the November 12 finality stall.</p>
      <div className="guide-actions"><a href="/releases/2026-11-13-kes-followups/bloch-pos" download>Download signed binary</a><a href="/releases/2026-11-13-kes-followups/README.md">Upgrade and verification instructions</a></div>
      <ul>
        <li><a href="/releases/2026-11-13-kes-followups/SHA256SUMS">Checksum manifest</a> · <a href="/releases/2026-11-13-kes-followups/SHA256SUMS.minisig" download>Minisign signature</a> · <a href="/releases/2026-11-13-kes-followups/bloch-release-20260922.pub" download>Minisign public key</a></li>
        <li><a href="/releases/2026-11-13-kes-followups/BUILD-INFO">Build provenance</a> · <a href="/releases/2026-11-13-kes-followups/release.json">Release metadata</a> · <a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/releases/tag/node-906336fd-kes-followups">GitHub release</a></li>
      </ul>
      <p>Expected SHA-256: <code>dfe9ce67eb265c3cca9309bf68ce6537ce5637251d3c7691c3532de59cbc440e</code>.</p>
      <p>Upgrade an existing synchronized Genesis-4 node while preserving its identity, signing records, signer anchor and chain data. The first start replays the chain from genesis (about 70 minutes on a validator-class host), then waits the normal 64-slot observation before the first attestation. Upgrade validators that share a key set one at a time. This upgrade bundle contains no keys.</p>
      <p><a href="/releases/2026-11-12-secfix/README.md">Previous signed release — November 12 (security hardening)</a></p>
      <p><a href="/releases/2026-10-29-hf123/README.md">Previous signed release — October 29 (HF1, HF2, HF3)</a></p>
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
