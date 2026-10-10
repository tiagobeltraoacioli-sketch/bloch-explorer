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
    <section className="guide-section" id="delegation-preview" aria-label="Funded delegation release candidate">
      <h2>Funded delegation release candidate — October 4 activation boundary</h2>
      <p><strong>Laboratory lifecycle passed; mainnet rollout pending.</strong> The corrected candidate passed the complete CLI/RPC rehearsal, including mature withdrawal, exact payout accounting and rejection of a second withdrawal. Two independent builds match, and the exact release binary passed historical mainnet replay. Coordinated network upgrade readiness remains unresolved.</p>
      <p>The candidate schedules delegation at <strong>epoch 4669, slot 149408</strong>: October 4, 2026 at <strong>18:35:19.962 UTC</strong> (15:35:19.962 in Brasília). Installing this executable arms that fixed boundary. Do not install it on mainnet before network upgrade coordination is complete.</p>
      <p>This replaces the <a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/releases/tag/funded-delegation-epoch-4669-preview">epoch-4669 preview with failed lifecycle qualification</a>. Its signed assets remain available as historical evidence. No production validator has been migrated by this release workflow.</p>
      <div className="guide-actions"><a href="/releases/2026-10-02-delegation-e4669-rc1/bloch-pos" download>Download signed RC1 · Linux x86-64</a><a href="/releases/2026-10-02-delegation-e4669-rc1/README.md">Verification and activation notes</a></div>
      <ul>
        <li><a href="/releases/2026-10-02-delegation-e4669-rc1/SHA256SUMS">Signed checksum manifest</a> · <a href="/releases/2026-10-02-delegation-e4669-rc1/SHA256SUMS.minisig" download>Minisign signature</a> · <a href="/releases/2026-10-02-delegation-e4669-rc1/bloch-release-20260922.pub" download>Release public key</a></li>
        <li><a href="/releases/2026-10-02-delegation-e4669-rc1/BUILD-INFO">Build provenance</a> · <a href="/releases/2026-10-02-delegation-e4669-rc1/release.json">Qualification snapshot</a> · <a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/releases/tag/funded-delegation-epoch-4669-rc1">GitHub prerelease and qualification updates</a></li>
      </ul>
      <p>Expected SHA-256: <code>22478fc5797ff673d390ed91b5b6a5120aa389b9bdbf798cf6b1abf99e60f7ba</code>.</p>
      <p>The laboratory used three validators and an old observer, 100 ms slots, and the unchanged 32-epoch cooldown and 2,048-epoch withdrawal delay. These results do not confirm fresh bootstrap, P2B internal tests or readiness of the 44 active validators outside the operator’s 95-validator inventory.</p>
      <p>The delegated-principal ceiling is 500,000,000 BLCH per validator. Operator commission changes require separate finalized transactions after activation; this download does not set commissions or delegate funds. Qualification details above describe the publication snapshot; follow the GitHub release for later results.</p>
    </section>
    <section className="guide-section" aria-label="Validator upgrade release">
      <h2>October 9 release with checkpoint 5120 — required upgrade</h2>
      <p>This distribution pairs checkpoint 5120 with the signed Linux x86-64 binary from commit <code>3a68f10bca501626dca54faab74a80a019057562</code>. The executable (funded delegation, required since epoch 4669) is byte-identical to the October 2 release candidate; it replaces the September 24 binary, which rejects funded-delegation blocks (from slot 155,538, October 6) and leaves the canonical chain. Existing operators must upgrade, and preserve their chain data, keys, command-line arguments and slashing-protection records.</p>
      <div className="guide-actions"><a href="/releases/2026-10-09/bloch-pos" download>Download signed binary</a><a href="/releases/2026-10-09/README.md">Installation and verification instructions</a></div>
      <ul>
        <li><a href="/releases/2026-10-09/SHA256SUMS">Signed checksum manifest</a> · <a href="/releases/2026-10-09/SHA256SUMS.minisig" download>Minisign signature</a> · <a href="/releases/2026-10-09/bloch-release-20260922.pub" download>Minisign public key</a></li>
        <li><a href="/releases/2026-10-09/BUILD-INFO">Build provenance</a> · <a href="/releases/2026-10-09/release.json">Release metadata</a> · <a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/tree/3a68f10bca501626dca54faab74a80a019057562">Pinned source</a></li>
      </ul>
      <p>Expected SHA-256: <code>22478fc5797ff673d390ed91b5b6a5120aa389b9bdbf798cf6b1abf99e60f7ba</code>.</p>
      <p>Before restarting, verify the signer-set pin required by <code>--ws-signer-set-sha3</code>. After replay, allow the two-epoch doppelganger observation before expecting validator activation. See the upgrade instructions for the complete checks.</p>
      <p><a href="/releases/2026-09-24/README.md">Original signed binary release — September 24</a></p>
    </section>
    <section className="guide-section" aria-label="Start a new validator">
      <h2>Start a new validator</h2>
      <p>Download the verified Linux release, synchronize an observer, prepare your identity offline, then submit a reviewed deposit through your own node. You need at least 25,000 BLCH plus fees in eligible native outputs.</p>
      <div className="guide-actions"><a href="/docs/validator-onboarding.md">Complete onboarding instructions →</a><a href="/downloads/prepare-node.sh" download>Download node preparation script</a></div>
      <ul>
        <li><a href="/releases/2026-10-09/bloch-pos" download>Linux x86_64 executable</a> · <a href="/releases/2026-09-14/mainnet.manifest" download>Genesis</a> · <a href="/releases/2026-09-14/carryover.tsv.gz" download>Carryover</a></li>
        <li><a href="https://github.com/tiagobeltraoacioli-sketch/bloch-sis-pow/tree/3a68f10bca501626dca54faab74a80a019057562">Build source</a> · <a href="/releases/2026-10-09/SHA256SUMS">Signed SHA-256 checksums</a> · <a href="/releases/2026-10-09/release.json">Release metadata</a></li>
        <li><a href="/downloads/prepare-identity.sh" download>Manual offline identity helper</a> · <a href="/downloads/deposit-submit.py" download>Local deposit preflight and submission helper</a></li>
      </ul>
      <p>The identity helper invokes the existing utility with its devnet/throwaway label; review its custody limitations in the onboarding instructions. Production keys must be handled by their human custodians outside agent sessions. Full mainnet withdrawal-and-spend qualification is still pending.</p>
    </section>
    <div className="guide-section onboarding-layout" dangerouslySetInnerHTML={{ __html: onboardingHtml }} />
    <section className="guide-section" id="confianca" aria-label="Signed checkpoint"><h2>Public checkpoint — epoch 5120</h2><p>Exchange observers need no validator key or bond. This envelope was signed on October 9, 2026 and carries three valid signatures. All three keys were used on the same Mac; independent custody has not been established. Review <a href="/checkpoints/epoch-5120/verification.json">the verification record and its limits</a> before choosing this trust anchor.</p><p>Renew before epoch 7136, November 1, 2026 at 04:27:19.962 UTC. The installer checks expiry and passes the required signer-set fingerprint. This release does not claim a new full mainnet synchronization test.</p><p><a href="/docs/renovar-checkpoint.md">Instructions to generate and sign a future checkpoint (.md)</a></p><ul>{["ws-envelope.bin", "signer-set.bin", "checkpoint.bin", "checkpoint.json", "verification.json", "SHA256SUMS.txt"].map(name => <li key={name}><a href={"/checkpoints/epoch-5120/" + name} download>{name}</a></li>)}</ul></section>
    <section className="guide-section" aria-label="Technical documentation"><h2>Release technical documentation</h2><ul>
      <li><a href="/docs/funded-validator-admission.md">Funded admission and offline signing</a></li>
      <li><a href="/docs/validator-exit-and-withdrawal.md">ADR-041: exit and withdrawal</a></li>
      <li><a href="/docs/validator-key-custody.md">Key preparation and custody</a></li>
    </ul></section>
  </article>;
}
