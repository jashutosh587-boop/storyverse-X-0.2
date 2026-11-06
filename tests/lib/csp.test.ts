import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce } from '@/lib/csp';

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `) || d === name);

describe('createNonce', () => {
  it('is 16 random bytes in base64 and differs every time', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('buildCsp in production', () => {
  const csp = buildCsp('NONCE123', false);

  it('lets scripts and styles run only with the nonce', () => {
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'nonce-NONCE123' 'strict-dynamic'");
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'nonce-NONCE123'");
  });

  it('allows no eval and no blanket inline script or style', () => {
    expect(csp).not.toContain('unsafe-eval');
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
    expect(directive(csp, 'style-src')).not.toContain('unsafe-inline');
  });

  it('only allows inline style attributes, which next/image needs', () => {
    expect(directive(csp, 'style-src-attr')).toBe("style-src-attr 'unsafe-inline'");
  });

  it('keeps the browser away from other origins and from framing the site', () => {
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https:");
    expect(directive(csp, 'media-src')).toBe("media-src 'self' blob: https:");
    expect(directive(csp, 'worker-src')).toBe("worker-src 'self' blob:");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(csp, 'form-action')).toBe("form-action 'self'");
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  it('upgrades insecure requests on https pages only', () => {
    expect(buildCsp('n', false, true)).toContain('upgrade-insecure-requests');
    expect(buildCsp('n', false)).toContain('upgrade-insecure-requests');
    expect(buildCsp('n', false, false)).not.toContain('upgrade-insecure-requests');
  });
});

describe('buildCsp in development', () => {
  const csp = buildCsp('NONCE123', true);

  it('relaxes only what the dev server needs', () => {
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toContain('https:');
    expect(directive(csp, 'connect-src')).toContain('ws:');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});
