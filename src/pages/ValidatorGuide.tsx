// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect } from "react";
import { validatorGuide } from "../data/validatorGuide";
import { Link } from "../lib/router";
import "../validator-guide.css";

export function ValidatorGuidePage() {
  useEffect(() => {
    const before = document.title;
    document.title = "Validator guide · Bloch";
    return () => { document.title = before; };
  }, []);
  return <article className="container validator-guide" lang="en">
    <header className="guide-heading">
      <span className="eyebrow">GENESIS-4 / OPERATIONS GUIDE</span>
      <h1>{validatorGuide.title}</h1>
      <p>Installation, identity, synchronization and maintenance with the new validator binary.</p>
      <p className="guide-date">Reviewed on {validatorGuide.updated}. The migration figures are a dated observation.</p>
      <div className="guide-actions"><a href="/docs/manual-validador.md" download>Download guide (.md)</a><Link to="/validators">View validators →</Link><Link to="/validators/queues">View queues →</Link></div>
    </header>
    <aside className="guide-notice" aria-label="Requirements for new operators">
      <strong>Before starting a new identity</strong>
      <p>This guide does not announce public admission. A new server needs a valid trusted checkpoint; a new identity needs registration, open admission and on-chain activation. Check sections 1, 3 and 6.</p>
    </aside>
    <nav className="guide-toc" aria-label="Guide contents"><h2>In this guide</h2><ol>{validatorGuide.sections.map(s => <li key={s.id}><a href={"#" + s.id}>{s.title.replace(/^\d+\. /, "")}</a></li>)}</ol></nav>
    {validatorGuide.sections.map(s => <section className="guide-section" id={s.id} key={s.id}>
      <h2>{s.title}</h2>
      {s.blocks.map((b, i) => b.kind === "code" ? <pre key={i} tabIndex={0} aria-label={"Example: " + s.title}><code>{b.text}</code></pre> : <p key={i}>{b.text}</p>)}
    </section>)}
    <section className="guide-section" aria-label="Signed checkpoint"><h2>Public checkpoint — epoch 1536</h2><p><a href="/docs/renovar-checkpoint.md">Full instructions to generate and sign the next checkpoint (.md)</a></p><p>Three valid signatures. Renew before epoch 3552, on September 22, 2026 at 08:43:19 UTC. Read section 3 before use.</p><ul>{["ws-envelope.bin", "signer-set.bin", "checkpoint.bin", "checkpoint.json", "verification.json", "SHA256SUMS.txt"].map(name => <li key={name}><a href={"/checkpoints/epoch-1536/" + name} download>{name}</a></li>)}</ul></section>
    <section className="guide-section" aria-label="Technical documentation"><h2>Release technical documentation</h2><ul>
      <li><a href="/docs/funded-validator-admission.md">Funded admission and offline signing</a></li>
      <li><a href="/docs/validator-exit-and-withdrawal.md">ADR-041: exit and withdrawal</a></li>
      <li><a href="/docs/validator-key-custody.md">Key preparation and custody</a></li>
    </ul></section>
  </article>;
}
