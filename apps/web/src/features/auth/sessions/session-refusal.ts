import { AsyncLocalStorage } from 'node:async_hooks';

const heardRefusal = new AsyncLocalStorage<{ refusal?: unknown }>();

/** Better Auth's logger hands a refusal it heard to the session read it belongs to. */
export function hearSessionRefusal(refusal: unknown) {
  const heard = heardRefusal.getStore();
  if (heard) heard.refusal = refusal;
}

/**
 * Better Auth logs a session read's refusal and rethrows a bare error without
 * its cause, so its logger is the only place left to hear it. This fails the
 * read with the refusal itself, so a caller can tell work that never ran.
 */
export function keepingSessionRefusal<T>(read: () => Promise<T>): Promise<T> {
  const heard: { refusal?: unknown } = {};
  return heardRefusal.run(heard, async () => {
    try {
      return await read();
    } catch (error) {
      throw heard.refusal ?? error;
    }
  });
}
