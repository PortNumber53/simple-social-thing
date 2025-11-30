import { useCallback, useState } from 'react';

export function useRequestState<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: TArgs) => {
      setLoading(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || 'request_failed');
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [fn],
  );

  return { loading, error, setError, run } as const;
}
