import { readTypingResponse } from './typing-response';

/**
 * After a write refused as too soon (a 429 from DEC-251's one signal per
 * 3 s), or one the network dropped, the writer waits this long before
 * trying again instead of posting on every keystroke. A definite refusal
 * stops renewal.
 */
export const TYPING_RETRY_MS = 3_000;
/** Serializes intent writes, coalesces raw keystrokes and renews only at a server-supplied bound. */
export function createTypingWriter({
  channelId,
  write,
  timers,
}: {
  readonly channelId: string;
  readonly write: (typing: boolean) => Promise<Response>;
  readonly timers: {
    readonly setTimeout: (callback: () => void, ms: number) => unknown;
    readonly clearTimeout: (id: unknown) => void;
  };
}) {
  let desired = false,
    busy = false,
    closed = false,
    queued = false,
    // A definite refusal (401, 403, 404, 400, 503): no renewal, and no post
    // per keystroke, until the member stops and starts again.
    stalled = false;
  let timer: unknown = null;
  let completion = Promise.resolve();
  const cancel = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const flush = async () => {
    busy = true;
    do {
      queued = false;
      const sent = desired;
      const response = await write(sent).catch(() => null);
      // Too soon (429) or a dropped request: one back-off, then retry. A
      // definite refusal (401, 403, 404, 400, 503) stalls instead.
      const interval =
        response === null || response.status === 429
          ? TYPING_RETRY_MS
          : ((await readTypingResponse(channelId, response))?.refreshAfterMs ??
            null);
      stalled = sent && interval === null;
      if (!queued && !closed && desired && interval !== null)
        timer = timers.setTimeout(() => {
          timer = null;
          return trigger();
        }, interval);
    } while (queued);
    busy = false;
  };
  const trigger = () => {
    if (busy) {
      queued = true;
      return completion;
    }
    completion = flush();
    return completion;
  };
  return {
    activity(typing: boolean) {
      if (closed) return completion;
      const changed = desired !== typing;
      desired = typing;
      if (changed) {
        cancel();
        stalled = false;
      }
      if (changed || (!busy && !stalled && timer === null && typing))
        return trigger();
      return completion;
    },
    close() {
      if (closed) return completion;
      closed = true;
      cancel();
      desired = false;
      return trigger();
    },
  };
}
