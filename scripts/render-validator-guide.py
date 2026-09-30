#!/usr/bin/env python3
"""Render the authored onboarding Markdown for the explorer and institutional sites."""
from pathlib import Path
import html,json,re
root=Path(__file__).resolve().parents[1]
source=(root/'public/docs/validator-onboarding.md').read_text()
def inline(s):
 s=html.escape(s)
 s=re.sub(r'`([^`]+)`',r'<code>\1</code>',s)
 s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',lambda m:'<a href="'+('https://blochl1.com'+m[2] if m[2].startswith('/') else m[2])+'">'+m[1]+'</a>',s)
 return re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',s)
lines=source.splitlines();out=[];toc=[];i=0
while i<len(lines):
 line=lines[i]
 if not line.strip():i+=1;continue
 if line.startswith('```'):
  lang=line[3:];i+=1;code=[]
  while i<len(lines) and not lines[i].startswith('```'):code.append(lines[i]);i+=1
  out.append('<pre tabindex="0"><code>'+html.escape('\n'.join(code))+'</code></pre>');i+=1;continue
 if line.startswith('#'):
  n=len(line)-len(line.lstrip('#'));title=line[n:].strip();anchor=re.sub(r'[^a-z0-9]+','-',title.lower()).strip('-')
  if n==1:i+=1;continue
  if n==2:toc.append((anchor,title))
  if title.startswith('8. Keep the node'):out.append('<span id="servico"></span>')
  out.append(f'<h{n} id="{anchor}">{inline(title)}</h{n}>');i+=1;continue
 if line.startswith('- '):
  items=[]
  while i<len(lines) and lines[i].startswith('- '):items.append('<li>'+inline(lines[i][2:])+'</li>');i+=1
  out.append('<ul>'+''.join(items)+'</ul>');continue
 paragraph=[line];i+=1
 while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','```','- ')):paragraph.append(lines[i]);i+=1
 out.append('<p>'+inline(' '.join(paragraph))+'</p>')
nav='<nav class="onboarding-toc" aria-label="On this page"><h2>Step by step</h2><ol>'+''.join('<li><a href="#'+a+'">'+inline(t)+'</a></li>' for a,t in toc)+'</ol></nav>'
body=nav+'<div class="onboarding-content">'+''.join(out)+'</div>'
(root/'src/data/validatorOnboarding.html').write_text(body+'\n')
page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Run a Bloch validator · Postern Labs</title><meta name="description" content="Install the Bloch CLI, verify the checkpoint, create an offline identity, fund and sign a validator deposit, and monitor activation."><link rel="stylesheet" href="/validators/guide.css"></head><body><a class="skip" href="#main">Skip to guide</a><header class="site-nav"><a href="/">postern labs</a><nav aria-label="Main navigation"><a href="/build.html">Developers</a><a href="https://blochprotocol.dev/">RPC documentation</a><a href="https://blochl1.com/validators">Live validators ↗</a></nav></header><main id="main"><header class="hero"><p class="eyebrow">BLOCH GENESIS-4 / VALIDATOR OPERATIONS</p><h1>Run a Bloch validator.</h1><p>From the first CLI download to a synchronized node and verified participation.</p><div class="facts"><span>Linux x86_64</span><span>25,000 BLCH + fees</span><span>Two signing roles</span></div><div class="actions"><a href="https://blochl1.com/downloads/prepare-node.sh">Download node setup</a><a href="https://blochl1.com/docs/validator-onboarding.md">Download Markdown guide</a><a href="https://blochl1.com/validators/guide">Live admission status ↗</a></div></header><article class="onboarding-layout">'''+body+'''</article></main><footer>Postern Labs · Guide updated September 30, 2026 · <a href="https://blochl1.com/docs/validator-qualification.md">Remaining qualification</a> · <a href="#main">Back to top</a></footer></body></html>'''
(root/'validator-guide-site/guide.html').write_text(page)
print('Generated',len(toc),'sections from one Markdown source.')
