import { createAppError } from '@daisy/errors';

/**
 * `work`'s result, or a CONFLICT refusal as soon as `signal` aborts: for a
 * wait that does not itself listen for the abort.
 */
export async function unlessAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
  message: string,
): Promise<T> {
  const stop = Promise.withResolvers<never>();
  stop.promise.catch(() => undefined);
  const abort = () => stop.reject(createAppError('CONFLICT', message));
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([work, stop.promise]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
