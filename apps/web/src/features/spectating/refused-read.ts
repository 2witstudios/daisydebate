import { isTemporaryRefusal } from '@daisy/db/capacity';

/** How long a viewer stays away after the audience lane refused them. */
const COME_BACK_SECONDS = 2;

/**
 * An audience read on a full lane is an expected answer, not a failure: nothing
 * ran, it reports nothing, and it says when to come back (ADR 0088 §4). Anything
 * else still throws to the operation's own handling.
 */
export const answerUnlessRefused = async (
  answer: () => Promise<Response>,
): Promise<Response> => {
  try {
    return await answer();
  } catch (error) {
    if (!isTemporaryRefusal(error)) throw error;
    return Response.json(
      { error: { code: 'INFRASTRUCTURE' } },
      {
        status: 503,
        headers: { 'Retry-After': String(COME_BACK_SECONDS) },
      },
    );
  }
};

/**
 * What a page shows beside the audience never outranks the page: a refused read
 * only leaves `fallback` for this render. Any other failure still throws.
 */
export const readUnlessRefused = async <T>(
  read: () => Promise<T>,
  fallback: T,
): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    if (!isTemporaryRefusal(error)) throw error;
    return fallback;
  }
};
