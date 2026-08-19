/**
 * Safely handle an error by logging the full details (including stack trace)
 * server-side and returning a generic message that is safe to expose in HTTP
 * responses. This prevents stack-trace exposure to clients.
 *
 * @param e       The caught error value.
 * @param context A label identifying where the error occurred (for logs).
 * @returns A generic error message safe for client responses.
 */
export function safeErrorMessage(e: unknown, context: string): string {
  const detail = e instanceof Error ? e.message : String(e);
  const stack = e instanceof Error ? e.stack : undefined;
  console.error(context, { message: detail, stack });
  return 'Internal error';
}
