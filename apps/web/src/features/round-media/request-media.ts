import { mediaFailure, transientMediaFailure } from './media-controller';

/** One request deadline includes headers and body; effects belong to the media mount. */
export function createMediaRequest(input: {
  readonly fetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly scheduleDeadline: (expire: () => void) => () => void;
}) {
  return async (
    roundId: string,
    operation: 'session' | 'reconcile',
    parent: AbortSignal,
  ): Promise<unknown> => {
    const controller = new AbortController();
    const interruption = Promise.withResolvers<never>();
    const cancel = () => {
      controller.abort();
      interruption.reject(
        new DOMException('Media request cancelled', 'AbortError'),
      );
    };
    parent.addEventListener('abort', cancel, { once: true });
    const cancelDeadline = input.scheduleDeadline(() => {
      controller.abort();
      interruption.reject(transientMediaFailure());
    });
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
      } catch (error) {
        if (parent.aborted) throw error;
        throw transientMediaFailure();
      }
      if (!response.ok) throw mediaFailure(response.status);
      try {
        return (await response.json()) as unknown;
      } catch (error) {
        if (parent.aborted) throw error;
        throw transientMediaFailure();
      }
    };
    try {
      if (parent.aborted) {
        cancel();
        return await interruption.promise;
      }
      return await Promise.race([read(), interruption.promise]);
    } finally {
      cancelDeadline();
      parent.removeEventListener('abort', cancel);
    }
  };
}
