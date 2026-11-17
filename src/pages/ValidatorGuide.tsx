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
      <p className="guide-date">Upgrade release updated November 16, 2026. Other qualification records retain their original dates.</p>
      <div className="guide-actions"><a href="/docs/validator-onboarding.md" download>Download guide (.md)</a><Link to="/validators">View validators →</Link><Link to="/validators/queues">View queues →</Link></div>
    </header>
    <ValidatorAdmissionStatus />
    <section className="guide-section" aria-label="Validator upgrade release">
      <h2>November 15 recommended upgrade: KES bind liveness and hardening</h2>
      <p>Signed Linux x86-64 release from commit <code>0067547f1cd8f740fa1b814361526a80be178885</code>. It builds on the November 13 mandatory release and adds no hard fork and no new activation: it carries the same epoch-8620 rules, and a full replay of mainnet history reproduces the canonical chain bit for bit. <strong>Every node must still run the November 13 release or this one before epoch 8620 (2026-11-17 16:11 UTC)</strong>; running this one satisfies that requirement. It is <strong>recommended for every node before the network binds KES keys</strong> (the bind is announced in advance on the official channels): block production and admission stay live through empty epochs and sibling heads around the bind. It also includes security hardening from the November 14 audit, dependency updates, and optional monitoring hooks that are off by default.</p>
      <div className="guide-actions"><a href="/releases/2026-11-15-node-local/bloch-pos" download>Download signed binary</a><a href="/releases/2026-11-15-node-local/README.md">Upgrade and verification instructions</a></div>
      <ul>
        <li><a href="/releases/2026-11-15-node-local/SHA256SUMS">Checksum manifest</a> · <a href="/releases/2026-11-15-node-local/SHA256SUMS.minisig" download>Minisign signature</a> · <a href="/releases/2026-11-15-node-local/bloch-release-20260922.pub" download>Minisign public key</a></li>
        <li><a href="/releases/2026-11-15-node-local/BUILD-INFO">Build provenance</a> · <a href="/releases/2026-11-15-node-local/release.json">Release metadata</a> · <a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/releases/tag/node-0067547f-node-local">GitHub release</a></li>
      </ul>
      <p>Expected SHA-256: <code>2c9547c0f68e6f69587cd7ed1e97c3a912304fd23b453bf3eb646e65200755e3</code>.</p>
      <p>Upgrade an existing synchronized Genesis-4 node while preserving its identity, signing records, signer anchor, chain data and flags; no new flag is required. The first start replays the chain from genesis (about 70 minutes on a validator-class host), then waits the normal 64-slot observation before the first attestation. Upgrade validators that share a key set one at a time. This upgrade bundle contains no keys.</p>
      <p><a href="/releases/2026-11-13-kes-followups/README.md">Previous signed release — November 13 (mandatory before epoch 8620)</a></p>
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
