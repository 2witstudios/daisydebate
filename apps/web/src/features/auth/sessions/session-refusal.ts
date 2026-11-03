import { AsyncLocalStorage } from 'node:async_hooks';

const noted = new AsyncLocalStorage<{ refusal?: unknown }>();

/** Better Auth's logger gives a refusal it logged to the session read in progress. */
export function noteSessionRefusal(refusal: unknown) {
  const read = noted.getStore();
  if (read) read.refusal = refusal;
}

/** The bare error Better Auth raises in place of a store failure it logged. */
const isBareSessionFailure = (error: unknown) =>
  (error as { body?: { code?: unknown } } | null)?.body?.code ===
  'FAILED_TO_GET_SESSION';

/**
 * Better Auth logs a session read's refusal and rethrows a bare error without
 * its cause, so its logger is the only place left to learn it. This fails the
 * read with the refusal itself, so a caller can tell work that never ran. Any
 * other failure is not the logged one, and stays what it is.
 */
export function keepingSessionRefusal<T>(read: () => Promise<T>): Promise<T> {
  const note: { refusal?: unknown } = {};
  return noted.run(note, async () => {
    try {
      return await read();
    } catch (error) {
      throw isBareSessionFailure(error) ? (note.refusal ?? error) : error;
    }
  });
}
