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
      <p className="guide-date">Upgrade release updated October 29, 2026. Other qualification records retain their original dates.</p>
      <div className="guide-actions"><a href="/docs/validator-onboarding.md" download>Download guide (.md)</a><Link to="/validators">View validators →</Link><Link to="/validators/queues">View queues →</Link></div>
    </header>
    <ValidatorAdmissionStatus />
    <section className="guide-section" aria-label="Validator upgrade release">
      <h2>October 29 required upgrade: network upgrades HF1, HF2, HF3</h2>
      <p>Signed Linux x86-64 release from commit <code>78d4921c3ec6ba41829f3878eed47f8d3bb96230</code>. It schedules three network upgrades: HF1 at epoch 7180 (2026-11-01 16:11 UTC, second step at epoch 7186), HF2 at epoch 7270 (2026-11-02 16:11 UTC) and HF3 at epoch 7360 (2026-11-03 16:11 UTC), with KES enforcement at epoch 8620 (2026-11-17 16:11 UTC). <strong>Install it before epoch 7180.</strong> A node that is not upgraded will not follow the upgraded chain from epoch 7180. L2 infrastructure and indexers must install builds made against this release before epoch 7178 (2026-11-01 15:39 UTC).</p>
      <div className="guide-actions"><a href="/releases/2026-10-29-hf123/bloch-pos" download>Download signed binary</a><a href="/releases/2026-10-29-hf123/README.md">Upgrade and verification instructions</a></div>
      <ul>
        <li><a href="/releases/2026-10-29-hf123/SHA256SUMS">Checksum manifest</a> · <a href="/releases/2026-10-29-hf123/SHA256SUMS.minisig" download>Minisign signature</a> · <a href="/releases/2026-10-29-hf123/bloch-release-20260922.pub" download>Minisign public key</a></li>
        <li><a href="/releases/2026-10-29-hf123/BUILD-INFO">Build provenance</a> · <a href="/releases/2026-10-29-hf123/release.json">Release metadata</a> · <a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/releases/tag/node-78d4921c-hf123">GitHub release</a></li>
      </ul>
      <p>Expected SHA-256: <code>700631b040a3a4b2299017162dd4a2c5f521bb49d5fa3c9ed677ba285673794e</code>.</p>
      <p>Upgrade an existing synchronized Genesis-4 node while preserving its identity, signing records, signer anchor and chain data. Verify the signature before installation and allow the normal 64-slot observation before expecting a new attestation. From epoch 7360 each validator registers a forward-secure (KES) key once, before epoch 8620; see the instructions. This upgrade bundle contains no keys or fresh bootstrap checkpoint.</p>
      <p><a href="/releases/2026-10-21-node-hardening/README.md">Previous signed release — October 21</a></p>
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
