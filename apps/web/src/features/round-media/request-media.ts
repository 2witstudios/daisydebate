import { cancelMediaWork } from './cancel-media-work';
import { mediaFailure, transientMediaFailure } from './media-controller';

/** One attempt's deadline, over headers and body. */
export const MEDIA_REQUEST_DEADLINE_MS = 10_000;
/** Pauses between attempts: 3.5 s, so about 43.5 s across four stalled attempts. */
export const MEDIA_RETRY_DELAYS_MS = [500, 1_000, 2_000] as const;

/** One request deadline includes headers and body; effects belong to the media mount. */
export function createMediaRequest(input: {
  readonly fetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly scheduleDeadline: (expire: () => void, ms: number) => () => void;
}) {
  return async (
    roundId: string,
    operation: 'session' | 'reconcile',
    parent: AbortSignal,
  ): Promise<unknown> => {
    const controller = new AbortController();
    const cancel = () => controller.abort(parent.reason);
    if (parent.aborted) cancel();
    else parent.addEventListener('abort', cancel, { once: true });
    const cancelDeadline = input.scheduleDeadline(
      () => controller.abort(transientMediaFailure()),
      MEDIA_REQUEST_DEADLINE_MS,
    );
    const read = async () => {
      let response: Response;
      try {
        response = await input.fetch(
          `/api/rounds/${encodeURIComponent(roundId)}/media/${operation}`,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: controller.signal,
            cache: 'no-store',
          },
        );
      } catch {
        throw transientMediaFailure();
      }
      if (!response.ok) throw mediaFailure(response.status);
      try {
        return (await response.json()) as unknown;
      } catch {
        throw transientMediaFailure();
      }
    };
    try {
      return await cancelMediaWork(controller.signal, read);
    } finally {
      cancelDeadline();
      // An unread non-OK or abandoned body must not hold the connection open.
      controller.abort();
      parent.removeEventListener('abort', cancel);
    }
  };
}
