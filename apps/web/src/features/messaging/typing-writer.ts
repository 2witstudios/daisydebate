import { readTypingResponse } from './typing-response';
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
    queued = false;
  let timer: unknown = null;
  let completion = Promise.resolve();
  const cancel = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const flush = async () => {
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    do {
      queued = false;
      const sent = desired;
      const interval =
        (await readTypingResponse(channelId, write(sent)))?.refreshAfterMs ??
        null;
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
      if (changed) cancel();
      if (changed || (!busy && timer === null && typing)) return trigger();
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
