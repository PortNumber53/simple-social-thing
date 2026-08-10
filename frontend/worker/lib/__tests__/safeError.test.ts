import { describe, expect, it, vi } from 'vitest';
import { safeErrorMessage } from '../safeError';

describe('safeErrorMessage', () => {
  it('returns generic message for Error instances', () => {
    const err = new Error('sensitive internal detail with /path/to/secret/file.ts');
    const result = safeErrorMessage(err, 'test-context');
    expect(result).toBe('Internal error');
    expect(result).not.toContain('sensitive');
    expect(result).not.toContain('/path/to/secret');
  });

  it('returns generic message for non-Error values', () => {
    const result = safeErrorMessage('some string error', 'test-context');
    expect(result).toBe('Internal error');
  });

  it('returns generic message for null/undefined', () => {
    expect(safeErrorMessage(null, 'test-context')).toBe('Internal error');
    expect(safeErrorMessage(undefined, 'test-context')).toBe('Internal error');
  });

  it('logs the full error details to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('detailed error message');
    err.stack = 'Error: detailed error message\n    at foo.ts:1:1';
    safeErrorMessage(err, '[TestHandler]');
    expect(spy).toHaveBeenCalledTimes(1);
    const [label, payload] = spy.mock.calls[0];
    expect(label).toBe('[TestHandler]');
    expect(payload).toMatchObject({
      message: 'detailed error message',
      stack: expect.stringContaining('foo.ts'),
    });
    spy.mockRestore();
  });

  it('logs stack as undefined for non-Error values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeErrorMessage('string error', '[TestHandler]');
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][1];
    expect(payload).toMatchObject({ message: 'string error', stack: undefined });
    spy.mockRestore();
  });

  it('never exposes the original error message in the return value', () => {
    const secrets = [
      'Error: ENOENT: no such file or directory /etc/passwd',
      'TypeError: Cannot read properties of undefined (reading "token")',
      'database connection failed: postgresql://user:password@host:5432/db',
    ];
    for (const s of secrets) {
      const result = safeErrorMessage(new Error(s), 'test');
      expect(result).toBe('Internal error');
      expect(result).not.toContain(s);
    }
  });
});
