/**
 * Where to send someone after signing in. Only same-site paths are accepted, so
 * a crafted link cannot bounce a visitor to another site (open redirect).
 */
const isLocalPath = (value: string) => value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(value);

export function safeNext(value: unknown, fallback = '/'): string {
  // One leading slash, no scheme, no backslashes, no control characters.
  if (typeof value !== 'string' || value === '' || !isLocalPath(value)) return fallback;
  try {
    const url = new URL(value, 'http://site.invalid');
    if (url.origin !== 'http://site.invalid') return fallback;
    const normalized = `${url.pathname}${url.search}${url.hash}`;
    // Dot segments are resolved by the URL parser, and "/..//host" resolves to "//host", which a browser reads as another site.
    return isLocalPath(normalized) ? normalized : fallback;
  } catch {
    return fallback;
  }
}
