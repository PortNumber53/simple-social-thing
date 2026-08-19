import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getMediaDurationSec } from '../media';

describe('getMediaDurationSec', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 for image kind without creating any element', async () => {
    const spy = vi.spyOn(document, 'createElement');
    const result = await getMediaDurationSec('blob:http://localhost/x', 'image');
    expect(result).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects unsafe URL schemes (javascript:)', async () => {
    await expect(getMediaDurationSec('javascript:alert(1)', 'video')).rejects.toThrow(
      /unsafe URL scheme/i,
    );
  });

  it('rejects unsafe URL schemes (data:)', async () => {
    await expect(getMediaDurationSec('data:text/html,<script>alert(1)</script>', 'audio')).rejects.toThrow(
      /unsafe URL scheme/i,
    );
  });

  it('rejects malformed URLs', async () => {
    await expect(getMediaDurationSec('not a url', 'video')).rejects.toThrow(/unsafe URL scheme/i);
  });
});
