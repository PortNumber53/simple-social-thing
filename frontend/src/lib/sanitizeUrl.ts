/**
 * Sanitize a user-provided URL so it is safe to use in DOM attributes such as
 * `img[src]` or `a[href]`. Only `http:`, `https:`, and protocol-relative URLs
 * are allowed. Everything else (including `javascript:` and `data:` URIs) is
 * rejected and a fallback is returned instead.
 *
 * @param url     The raw URL value (may be undefined/empty).
 * @param fallback Optional fallback URL returned when the input is unsafe.
 *                 Defaults to an empty string.
 */
export function sanitizeUrl(url: string | undefined | null, fallback = ''): string {
  if (!url) return fallback;
  const trimmed = url.trim();
  if (!trimmed) return fallback;
  try {
    // Protocol-relative URLs (//example.com/...) are allowed.
    if (trimmed.startsWith('//')) {
      return trimmed;
    }
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Convenience wrapper for image URLs — returns the provided fallback when the
 * URL is not a safe HTTP(S) URL.
 */
export function sanitizeImageUrl(url: string | undefined | null, fallback = ''): string {
  return sanitizeUrl(url, fallback);
}
