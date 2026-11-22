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
      <p className="guide-date">Upgrade release updated November 22, 2026. Other qualification records retain their original dates.</p>
      <div className="guide-actions"><a href="/docs/validator-onboarding.md" download>Download guide (.md)</a><Link to="/validators">View validators →</Link><Link to="/validators/queues">View queues →</Link></div>
    </header>
    <ValidatorAdmissionStatus />
    <section className="guide-section" aria-label="Validator upgrade release">
      <h2>November 19 recommended upgrade: the release for the KES bind</h2>
      <p>Signed Linux x86-64 release from commit <code>4cd9b887b2a2a171b26b55da5c53d08c427def1a</code>. It adds no hard fork and arms no gate: it carries the same rules as the November 15 release, and a full replay of mainnet history reproduces the canonical chain bit for bit. <strong>It is recommended for every node before the network binds KES keys.</strong> It keeps block admission live around the bind without a restart, makes finality proofs refuse stale KES state, contains faults in layer-2 pre-validation, adds off-by-default mesh options, and renews the built-in release checkpoint to epoch 8742, valid for fresh installs until epoch 10758 (2026-12-11 10:19 UTC); the checkpoint of the November 15 release stops accepting fresh installs on 2026-11-25, so new nodes should start from this one.</p>
      <div className="guide-actions"><a href="/releases/2026-11-19-kes-bind/bloch-pos" download>Download signed binary</a><a href="/releases/2026-11-19-kes-bind/README.md">Upgrade and verification instructions</a></div>
      <ul>
        <li><a href="/releases/2026-11-19-kes-bind/SHA256SUMS">Checksum manifest</a> · <a href="/releases/2026-11-19-kes-bind/SHA256SUMS.minisig" download>Minisign signature</a> · <a href="/releases/2026-11-19-kes-bind/bloch-release-20260922.pub" download>Minisign public key</a></li>
        <li><a href="/releases/2026-11-19-kes-bind/BUILD-INFO">Build provenance</a> · <a href="/releases/2026-11-19-kes-bind/release.json">Release metadata</a> · <a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/releases/tag/node-4cd9b887-kes-bind">GitHub release</a></li>
      </ul>
      <p>Expected SHA-256: <code>7d453d4f8d739cdb297a16dc4e34ece976d3a234df8ed6f44215cf2ead6db3a4</code>.</p>
      <p>Upgrade an existing synchronized Genesis-4 node while preserving its identity, signing records, signer anchor, chain data and flags; no new flag is required. The first start replays the chain from genesis (roughly 50 to 90 minutes on a validator-class host), then waits the normal 64-slot observation before the first attestation. Upgrade validators that share a key set one at a time. This upgrade bundle contains no keys.</p>
      <h3>KES keys</h3>
      <p>KES binds on chain on its own, two epochs after the first epoch boundary at which validators with a registered KES key hold at least 90% of the effective stake. Until then every validator signs with its static key, and a validator that never registers keeps signing with its static key afterwards. To register:</p>
      <ul>
        <li>Generate the key beside <code>validator.key</code>, with the same keystore unlock environment as the node: <code>bloch-pos kes keygen --dir &lt;data-dir&gt;</code>. It never overwrites an existing <code>validator.kes</code>.</li>
        <li>Restart the node on this release and check its log for <code>KES key loaded</code>. The node reads the key only at start, so <strong>a registered validator must have its key loaded before the bind</strong>.</li>
        <li>Prepare the one-time registration, <code>bloch-pos kes register --dir &lt;data-dir&gt; --genesis &lt;manifest&gt; --out &lt;file&gt;</code>, and broadcast the hex in <code>&lt;file&gt;</code> with <code>sendrawtransaction</code> through your own node at once. Do not share the file.</li>
        <li>The node evolves the key in place: never keep copies of <code>validator.kes</code> and never run two copies of the same validator.</li>
      </ul>
      <p><a href="/releases/2026-11-15-node-local/README.md">Previous signed release — November 15 (recommended before the KES bind)</a></p>
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
