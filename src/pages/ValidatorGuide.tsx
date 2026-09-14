// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect } from "react";
import { validatorGuide } from "../data/validatorGuide";
import { Link } from "../lib/router";
import "../validator-guide.css";

export function ValidatorGuidePage() {
  useEffect(() => {
    const before = document.title;
    document.title = "Manual do validador · Bloch";
    return () => { document.title = before; };
  }, []);
  return <article className="container validator-guide" lang="pt-BR">
    <header className="guide-heading">
      <span className="eyebrow">GENESIS-4 / MANUAL OPERACIONAL</span>
      <h1>{validatorGuide.title}</h1>
      <p>Instalação, identidade, sincronização e manutenção de um validador com o novo binário.</p>
      <p className="guide-date">Revisado em {validatorGuide.updated}. Os dados de migração citados são uma observação datada.</p>
      <div className="guide-actions"><a href="/docs/manual-validador.md" download>Baixar manual (.md)</a><Link to="/validators">Ver validadores →</Link><Link to="/validators/queues">Ver filas →</Link></div>
    </header>
    <aside className="guide-notice" aria-label="Condições para novos operadores">
      <strong>Antes de iniciar uma nova identidade</strong>
      <p>Este manual não anuncia abertura pública. Um servidor novo precisa de um checkpoint de confiança válido; uma nova identidade precisa de registro, admissão liberada e ativação na cadeia. Confira as condições nas seções 1, 3 e 6.</p>
    </aside>
    <nav className="guide-toc" aria-label="Índice do manual"><h2>Neste manual</h2><ol>{validatorGuide.sections.map(s => <li key={s.id}><a href={"#" + s.id}>{s.title.replace(/^\d+\. /, "")}</a></li>)}</ol></nav>
    {validatorGuide.sections.map(s => <section className="guide-section" id={s.id} key={s.id}>
      <h2>{s.title}</h2>
      {s.blocks.map((b, i) => b.kind === "code" ? <pre key={i} tabIndex={0} aria-label={"Exemplo: " + s.title}><code>{b.text}</code></pre> : <p key={i}>{b.text}</p>)}
    </section>)}
    <section className="guide-section" aria-label="Checkpoint assinado"><h2>Checkpoint público — época 1536</h2><p><a href="/docs/renovar-checkpoint.md">Roteiro completo para gerar e assinar o próximo checkpoint (.md)</a></p><p>Três assinaturas válidas. Renovação necessária antes da época 3552, em 22/09/2026 às 05h43min19s de Brasília. Confira a seção 3 antes de usar.</p><ul>{["ws-envelope.bin", "signer-set.bin", "checkpoint.bin", "checkpoint.json", "verification.json", "SHA256SUMS.txt"].map(name => <li key={name}><a href={"/checkpoints/epoch-1536/" + name} download>{name}</a></li>)}</ul></section>
    <section className="guide-section" aria-label="Documentação técnica"><h2>Documentação técnica da versão</h2><ul>
      <li><a href="/docs/funded-validator-admission.md">Admissão financiada e assinatura offline (inglês)</a></li>
      <li><a href="/docs/validator-exit-and-withdrawal.md">ADR-041: saída e saque (inglês)</a></li>
      <li><a href="/docs/validator-key-custody.md">Preparação e custódia das chaves (inglês)</a></li>
    </ul></section>
  </article>;
}
