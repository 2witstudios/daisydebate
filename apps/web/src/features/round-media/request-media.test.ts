import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaRequest } from './request-media';
import { requestFailureOf } from './media-failure';
const isTransientMediaFailure = (error: unknown) =>
  requestFailureOf(error) === 'transient';
import { trackedSignal } from './media-fixtures.test-support';

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

test('parent cancellation releases ignored-abort headers and body without waiting for deadline', async () => {
  const results = [];
  for (const body of [false, true]) {
    const timer = deadline();
    const parent = new AbortController();
    let signal: AbortSignal | undefined;
    const request = createMediaRequest({
      scheduleDeadline: timer.schedule,
      fetch: async (_url, options) => {
        signal = options?.signal ?? undefined;
        return body
          ? ({ ok: true, json: () => new Promise(() => undefined) } as Response)
          : new Promise<Response>(() => undefined);
      },
    });
    const pending = request('round', 'reconcile', parent.signal).catch(
      (error: unknown) => error,
    );
    parent.abort();
    const failure = await pending;
    results.push([
      failure instanceof DOMException && failure.name,
      signal?.aborted,
      timer.cancelled(),
    ]);
  }
  assert({
    given: 'parent disposal during ignored-abort headers or body',
    should: 'settle immediately as cancellation and release its deadline',
    actual: results,
    expected: [
      ['AbortError', true, 1],
      ['AbortError', true, 1],
    ],
  });
});

test('already cancelled parent does not start fetch', async () => {
  const parent = new AbortController();
  parent.abort();
  const timer = deadline();
  let fetched = 0;
  const request = createMediaRequest({
    scheduleDeadline: timer.schedule,
    fetch: async () => {
      fetched++;
      return Response.json({});
    },
  });
  const failure: unknown = await request(
    'round',
    'session',
    parent.signal,
  ).catch((error: unknown) => error);
  assert({
    given: 'a lifetime cancelled before request creation',
    should: 'avoid starting HTTP and release cancellation resources',
    actual: [
      fetched,
      failure instanceof DOMException && failure.name,
      timer.cancelled(),
    ],
    expected: [0, 'AbortError', 1],
  });
});

test('a non-OK answer releases its unread body and its one deadline', async () => {
  const timer = deadline();
  let signal: AbortSignal | undefined;
  const request = createMediaRequest({
    scheduleDeadline: timer.schedule,
    fetch: async (_url, options) => {
      signal = options?.signal ?? undefined;
      return new Response('{}', { status: 503 });
    },
  });
  const failure = await request(
    'round',
    'reconcile',
    new AbortController().signal,
  ).catch((error: unknown) => error);
  assert({
    given: 'a refused request whose body is never read',
    should: 'classify it, abort its own request and cancel its deadline once',
    actual: [
      isTransientMediaFailure(failure),
      signal?.aborted,
      timer.cancelled(),
    ],
    expected: [true, true, 1],
  });
});

test('the adapter runs on supported browsers without Promise.withResolvers', async () => {
  const native = Promise.withResolvers;
  Reflect.deleteProperty(Promise, 'withResolvers');
  try {
    const timer = deadline();
    const request = createMediaRequest({
      fetch: async () => Response.json({ version: 1 }),
      scheduleDeadline: timer.schedule,
    });
    assert({
      given: 'a browser older than Chrome 119 or Safari 17.4',
      should: 'still complete a media request',
      actual: await request('round', 'session', new AbortController().signal),
      expected: { version: 1 },
    });
  } finally {
    Promise.withResolvers = native;
  }
});

test('success, failure and cancellation all release the parent listener', async () => {
  const results = [];
  for (const fetch of [
    async () => Response.json({}),
    async () => new Response('{}', { status: 500 }),
  ]) {
    const parent = trackedSignal();
    const timer = deadline();
    const request = createMediaRequest({
      fetch,
      scheduleDeadline: timer.schedule,
    });
    await request('round', 'reconcile', parent.signal).catch(() => undefined);
    results.push(parent.listening());
  }
  const parent = trackedSignal();
  const timer = deadline();
  const request = createMediaRequest({
    fetch: () => new Promise<Response>(() => undefined),
    scheduleDeadline: timer.schedule,
  });
  const pending = request('round', 'reconcile', parent.signal).catch(
    () => undefined,
  );
  parent.abort();
  await pending;
  results.push(parent.listening());
  assert({
    given: 'a request that succeeds, is refused or is cancelled by its parent',
    should: 'leave no listener on the parent signal',
    actual: results,
    expected: [0, 0, 0],
  });
});
