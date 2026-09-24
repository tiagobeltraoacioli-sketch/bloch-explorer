# Shared validator guide

The authored source is `public/docs/validator-onboarding.md`. Run
`python3 scripts/render-validator-guide.py` from the explorer root to regenerate
both the explorer body and `guide.html`. The CSS is maintained separately.

The Worker serves `/validators`, `/validators/` and `/validators/guide` on
posternlabs.com and blochprotocol.io. On `/` and `/index.html`, it preserves
the validator links already provided by the Pages origin and points the wallet
card to the live Postern Wallet application. It adds a guide link to the
existing `/build` and `/build.html` entry page using the current
posternlabs.pages.dev origin. It does not replace the Pages deployment, modify
DNS or handle wallet, RPC or download routes. Keep its routes narrowly scoped.

Deploy from this directory with `wrangler deploy`. Build the explorer separately.
Validate the two public guide pages, stylesheet, developer-entry links, mobile
overflow, and preserved home, wallet and RPC responses after deployment.
