/**
 * Content-Security-Policy for one request.
 *
 * Scripts need the per-request nonce, so an injected <script> cannot run. App
 * data still travels through the server; the browser additionally fetches
 * licensed media and HLS manifests/segments directly from their HTTPS host.
 * `style-src-attr` allows inline style attributes next/image adds to <img>.
 */
export function buildCsp(nonce: string, isDev: boolean, secure = true): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    isDev ? `style-src 'self' 'unsafe-inline'` : `style-src 'self' 'nonce-${nonce}'`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self' https:${isDev ? ' ws: wss:' : ''}`,
    `media-src 'self' blob: https:`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  // Upgrading http subresources only makes sense on an https page. Over plain http (a local `next start`)
  // it would turn the page's own http://127.0.0.1 assets into https requests that nothing answers.
  if (!isDev && secure) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** 128 bits of randomness, base64 encoded. Works in the Edge runtime. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
