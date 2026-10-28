import { readTypingResponse } from './typing-response';

/**
 * After a transient failure (a dropped request, 408, a 429 from DEC-251's one
 * signal per 3 s, a 5xx, or an acknowledgement whose body does not parse) the
 * writer backs off before trying again: TYPING_RETRY_MS doubling per
 * consecutive failure up to TYPING_RETRY_MAX_MS, or the server's Retry-After
 * within those bounds, and back to the start on any acknowledged write.
 * Keystrokes during a back-off post nothing. A refusal (any other 4xx) stops
 * renewal. A dropped stop is not retried: the server's lease expiry clears it.
 */
export const TYPING_RETRY_MS = 3_000;
export const TYPING_RETRY_MAX_MS = 30_000;
const refusal = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;
const backOff = (failures: number, response: Response | null) => {
  const hint = response?.headers.get('retry-after') ?? '';
  const delay = /^[0-9]{1,6}$/.test(hint)
    ? Number(hint) * 1_000
    : TYPING_RETRY_MS * 2 ** failures;
  return Math.min(Math.max(delay, TYPING_RETRY_MS), TYPING_RETRY_MAX_MS);
};
/** The wait before the next write (null: a refusal stalls) and the failure streak after this answer. */
async function afterAnswer(
  channelId: string,
  response: Response | null,
  failures: number,
) {
  const acknowledged =
    response?.ok === true
      ? await readTypingResponse(channelId, response)
      : null;
  if (acknowledged !== null)
    return { interval: acknowledged.refreshAfterMs, failures: 0 };
  if (response !== null && refusal(response.status))
    return { interval: null, failures: 0 };
  return { interval: backOff(failures, response), failures: failures + 1 };
}
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
    // A refusal: no renewal, and no post per keystroke, until the member
    // stops and starts again.
    stalled = false,
    failures = 0;
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
      const next = await afterAnswer(
        channelId,
        await write(sent).catch(() => null),
        failures,
      );
      failures = next.failures;
      const interval = next.interval;
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
