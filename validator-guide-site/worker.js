import guide from './guide.html';
import css from './guide.css';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    if (url.pathname === '/validators/guide.css') return new Response(request.method === 'HEAD' ? null : css, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
    if (['/validators', '/validators/', '/validators/guide'].includes(url.pathname)) {
      return new Response(request.method === 'HEAD' ? null : guide, { headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate',
        'content-security-policy': "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
      } });
    }
    // Fetch only the existing public informational origin. No wallet, RPC or
    // download path is intercepted by this Worker's route configuration.
    const home = url.pathname === '/' || url.pathname === '/index.html';
    if (home || url.pathname === '/build' || url.pathname === '/build.html') {
      const upstream = new URL(home ? '/' : '/build.html', 'https://posternlabs.pages.dev');
      const response = await fetch(upstream, { method: request.method, redirect: 'follow' });
      if (!response.ok || request.method === 'HEAD' || !(response.headers.get('content-type') || '').includes('text/html')) return response;
      const rewriter = new HTMLRewriter();
      rewriter.on('.desktop-nav, .mobile-menu nav, .footer-links', {
        element(element) { element.append('<a href="/releases">Weekly releases</a>', { html: true }); }
      });
      if (home) rewriter.on('.hero-actions', {
        element(element) { element.append('<a class="button button-outline" href="/validators">Run a validator <span aria-hidden="true">→</span></a>', { html: true }); }
      });
      else rewriter.on('section#validators', {
        element(element) {
          element.prepend('<div class="callout"><h3>Run a Bloch validator — step by step</h3><p>Install the CLI, verify the checkpoint, prepare your identity, authorize the deposit and monitor activation.</p><a class="text-link" href="/validators">Open the complete validator guide →</a></div>', { html: true });
        }
      });
      return rewriter.transform(response);
    }
    return new Response('Not found', { status: 404 });
  }
};
