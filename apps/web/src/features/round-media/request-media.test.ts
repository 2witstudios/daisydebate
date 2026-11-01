import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaRequest } from './request-media';
import { isTransientMediaFailure } from './media-controller';

setupRitewayBun();

const deadline = () => {
  let expire: () => void = () => undefined;
  let cancelled = 0;
  return {
    schedule: (fire: () => void) => {
      expire = fire;
      return () => {
        cancelled++;
      };
    },
    expire: () => expire(),
    cancelled: () => cancelled,
  };
};

test('admission and response-body stalls share one cancellable bounded deadline', async () => {
  const results = [];
  for (const bodyStalls of [false, true]) {
    const timer = deadline();
    let signal: AbortSignal | undefined;
    const request = createMediaRequest({
      fetch: async (_url, options) => {
        signal = options?.signal ?? undefined;
        if (!bodyStalls) return new Promise(() => undefined);
        return {
          ok: true,
          json: () => new Promise(() => undefined),
        } as Response;
      },
      scheduleDeadline: timer.schedule,
    });
    const pending = request(
      'round',
      'session',
      new AbortController().signal,
    ).catch((error: unknown) => error);
    timer.expire();
    const failure = await pending;
    results.push([
      isTransientMediaFailure(failure),
      signal?.aborted,
      timer.cancelled(),
    ]);
  }
  assert({
    given:
      'stalled admission and stalled body reads even when an adapter ignores AbortSignal',
    should:
      'abort and classify each deadline transient, releasing its one timer',
    actual: results,
    expected: [
      [true, true, 1],
      [true, true, 1],
    ],
  });
});

test('a completed request releases the deadline and parent cancellation listener', async () => {
  const timer = deadline();
  const request = createMediaRequest({
    fetch: async () => Response.json({ version: 1 }),
    scheduleDeadline: timer.schedule,
  });
  const answer = await request(
    'round',
    'reconcile',
    new AbortController().signal,
  );
  assert({
    given: 'a successful response body',
    should: 'return it and cancel its deadline',
    actual: [answer, timer.cancelled()],
    expected: [{ version: 1 }, 1],
  });
});
