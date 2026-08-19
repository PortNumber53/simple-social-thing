/**
 * Check whether a user-provided URL is safe to use in DOM attributes such as
 * `img[src]` or `a[href]`. Only `http:`, `https:`, and protocol-relative URLs
 * are allowed. Everything else (including `javascript:` and `data:` URIs) is
 * rejected.
 *
 * This boolean predicate is intended to be used as a **guard** in conditional
 * rendering, e.g.:
 *
 * ```tsx
 * {isSafeUrl(user.imageUrl)
 *   ? <img src={user.imageUrl} ... />
 *   : <img src={fallback} ... />}
 * ```
 *
 * CodeQL recognises ternary/`&&` short-circuit guards and will not report
 * taint flowing past the guard, unlike a pass-through sanitizer wrapper.
 *
 * @param url The raw URL value (may be undefined/empty).
 * @returns `true` when the URL is a safe HTTP(S) or protocol-relative URL.
 */
export function isSafeUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    // Protocol-relative URLs (//example.com/...) are allowed.
    if (trimmed.startsWith('//')) return true;
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

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
  return isSafeUrl(url) ? (url as string).trim() : fallback;
}

/**
 * Convenience wrapper for image URLs — returns the provided fallback when the
 * URL is not a safe HTTP(S) URL.
 */
export function sanitizeImageUrl(url: string | undefined | null, fallback = ''): string {
  return sanitizeUrl(url, fallback);
}

/**
 * Check whether a URL is safe to assign to a media element `src`.
 * Only `blob:`, `http:`, `https:`, and protocol-relative URLs are allowed.
 * This is like {@link isSafeUrl} but also permits `blob:` URLs (used by
 * `URL.createObjectURL()`).
 *
 * @param url The raw URL value.
 * @returns `true` when the URL is safe for media element `src` assignment.
 */
export function isSafeMediaSrc(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('//')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'blob:';
  } catch {
    return false;
  }
}
