/**
 * A link from stored data, or null when it is not a plain web address. Source
 * links come from outside providers, so only http(s) is ever put in an href.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
