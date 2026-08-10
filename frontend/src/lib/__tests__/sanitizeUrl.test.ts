import { describe, expect, it } from 'vitest';
import { sanitizeUrl, sanitizeImageUrl } from '../sanitizeUrl';

describe('sanitizeUrl', () => {
  it('allows http and https URLs', () => {
    expect(sanitizeUrl('http://example.com/img.png')).toBe('http://example.com/img.png');
    expect(sanitizeUrl('https://example.com/img.png')).toBe('https://example.com/img.png');
  });

  it('allows protocol-relative URLs', () => {
    expect(sanitizeUrl('//example.com/img.png')).toBe('//example.com/img.png');
  });

  it('rejects javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeUrl('  javascript:alert(1)  ')).toBe('');
  });

  it('rejects data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('rejects malformed URLs', () => {
    expect(sanitizeUrl('not a url')).toBe('');
    expect(sanitizeUrl(':::broken')).toBe('');
  });

  it('returns fallback for empty/undefined/null', () => {
    expect(sanitizeUrl(undefined)).toBe('');
    expect(sanitizeUrl(null)).toBe('');
    expect(sanitizeUrl('')).toBe('');
    expect(sanitizeUrl('  ')).toBe('');
  });

  it('uses provided fallback', () => {
    expect(sanitizeUrl('javascript:alert(1)', 'https://fallback.com/img.png')).toBe('https://fallback.com/img.png');
    expect(sanitizeUrl(undefined, 'https://fallback.com/img.png')).toBe('https://fallback.com/img.png');
  });

  it('handles case-insensitive protocol schemes', () => {
    expect(sanitizeUrl('JaVaScRiPt:alert(1)')).toBe('');
    expect(sanitizeUrl('HTTPS://example.com/img.png')).toBe('HTTPS://example.com/img.png');
  });
});

describe('sanitizeImageUrl', () => {
  it('delegates to sanitizeUrl with fallback', () => {
    expect(sanitizeImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(sanitizeImageUrl('javascript:alert(1)', 'https://fb.com/p.png')).toBe('https://fb.com/p.png');
  });
});
