import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createClockReadWitness,
  serverOffsetMs,
  routeStepped,
} from '../e2e/support/round-timing-response';

setupRitewayBun();

test('the server offset comes from the shortest of its round trips', async () => {
  let time = 0;
  const trips = [
    { roundTripMs: 1500, stampAt: 1500 },
    { roundTripMs: 10, stampAt: 5 },
    { roundTripMs: 400, stampAt: 0 },
  ];
  let trip = 0;
  const offsetMs = await serverOffsetMs(
    async () => {
      const { roundTripMs, stampAt } = trips[trip++]!;
      const stamp = time + stampAt + 1000;
      time += roundTripMs;
      return stamp;
    },
    () => time,
  );
  assert({
    given:
      'a late-stamped slow trip, a quick trip and an early-stamped slow trip',
    should: 'take the quick one, whose midpoint is true to within its length',
    actual: offsetMs,
    expected: 1000,
  });
});

const CLOCK_BODY = Buffer.from('{"id":"round"}');
const mainFrame = { name: 'main' };

/**
 * A delivered clock read at the route seam. The browser's own response is
 * unreadable, as in the e5 trace; only the fetched APIResponse carries bytes.
 */
const delivery = ({
  frame = mainFrame as object,
  serverNow = '20000' as string | null,
  status = 200,
  fetchFailure = null as Error | null,
} = {}) => {
  const calls: string[] = [];
  const fulfilled: { response: unknown; body: Buffer }[] = [];
  const response = {
    status: () => status,
    headers: () =>
      (serverNow === null ? {} : { 'x-server-now-ms': serverNow }) as Record<
        string,
        string
      >,
    body: async () => CLOCK_BODY,
  };
  return {
    calls,
    fulfilled,
    response,
    route: {
      request: () => ({
        frame: () => frame,
        response: async () => ({
          text: async () => {
            throw new Error('Network.getResponseBody: no data found');
          },
        }),
      }),
      fallback: async () => {
        calls.push('fallback');
      },
      fetch: async () => {
        calls.push('fetch');
        if (fetchFailure) throw fetchFailure;
        return response;
      },
      fulfill: async (options: { response: unknown; body: Buffer }) => {
        calls.push('fulfill');
        fulfilled.push(options);
      },
    },
  };
};

const witnessAt = (documentEpoch = { current: 3 }, clock = { nowMs: 5000 }) =>
  createClockReadWitness({
    frame: mainFrame,
    documentEpoch: () => documentEpoch.current,
    now: () => clock.nowMs,
  });

test('the resume witness reads delivery bytes, never the browser response body', async () => {
  const witness = witnessAt();
  witness.arm();
  const matching = delivery();
  await witness.handle(matching.route);
  assert({
    given:
      'a matching clock read whose browser-side response body is unavailable',
    should: 'record only its safe status and server instant from the delivery',
    actual: witness.read(),
    expected: { status: 200, serverNowMs: 20000 },
  });
  assert({
    given: 'the captured clock response',
    should: 'forward the same response and exact bytes to the page',
    actual: [matching.calls, matching.fulfilled[0]],
    expected: [
      ['fetch', 'fulfill'],
      { response: matching.response, body: CLOCK_BODY },
    ],
  });
});

test('the resume witness leaves every other request untouched', async () => {
  const documentEpoch = { current: 3 };
  const witness = witnessAt(documentEpoch);
  const before = delivery();
  await witness.handle(before.route);
  witness.arm();
  const others = [delivery({ frame: { name: 'child' } })];
  for (const other of others) await witness.handle(other.route);
  documentEpoch.current = 4;
  const otherDocument = delivery();
  await witness.handle(otherDocument.route);
  assert({
    given:
      'requests before arming, from another frame, or from a later document',
    should: 'fall through unread and capture nothing',
    actual: [before, ...others, otherDocument].map(({ calls }) => calls),
    expected: Array.from({ length: 3 }, () => ['fallback']),
  });
  assert({
    given: 'no matching delivery yet',
    should: 'report nothing captured',
    actual: witness.read(),
    expected: null,
  });
});

test('the resume witness refuses a request started before the resume cutoff', async () => {
  const clock = { nowMs: 5000 };
  const witness = witnessAt({ current: 3 }, clock);
  witness.arm();
  clock.nowMs = 4999;
  const early = delivery();
  await witness.handle(early.route);
  assert({
    given: 'a matching request observed before the armed cutoff instant',
    should: 'not count as a newly started read',
    actual: [early.calls, witness.read()],
    expected: [['fallback'], null],
  });
});

test('the resume witness captures once and forwards later reads unread', async () => {
  const witness = witnessAt();
  witness.arm();
  const first = delivery();
  const second = delivery({ serverNow: '30000' });
  await witness.handle(first.route);
  await witness.handle(second.route);
  assert({
    given: 'two matching reads after the cutoff',
    should: 'keep the first capture and leave the second untouched',
    actual: [witness.read(), second.calls],
    expected: [{ status: 200, serverNowMs: 20000 }, ['fallback']],
  });
});

test('a matching read without clock evidence is recorded without a server instant', async () => {
  const witness = witnessAt();
  witness.arm();
  await witness.handle(delivery({ serverNow: null }).route);
  assert({
    given: 'a matching reply that carries no server instant',
    should: 'report a null instant the journey must reject',
    actual: witness.read(),
    expected: { status: 200, serverNowMs: null },
  });
});

test('a matching capture failure is fatal to the witness', async () => {
  const witness = witnessAt();
  witness.arm();
  const failure = new Error('upstream closed');
  await witness.handle(delivery({ fetchFailure: failure }).route);
  let thrown: unknown = null;
  try {
    witness.read();
  } catch (error) {
    thrown = error;
  }
  assert({
    given: 'the matching clock delivery cannot be captured',
    should: 'throw that failure from the read rather than report no evidence',
    actual: thrown,
    expected: failure,
  });
});

const serverActionsPage = () => {
  let handler: (route: never) => Promise<void> = async () => undefined;
  let routes = 0;
  return {
    routes: () => routes,
    deliver: (route: unknown) => handler(route as never),
    page: {
      route: async (_url: string, next: (route: never) => Promise<void>) => {
        routes++;
        handler = next;
      },
    },
  };
};
const actionRoute = (nextAction?: string, method = 'POST') => {
  const calls: string[] = [];
  return {
    calls,
    request: () => ({
      method: () => method,
      headers: () => (nextAction ? { 'next-action': nextAction } : {}),
    }),
    fallback: async () => {
      calls.push('fallback');
    },
  };
};

test('one stepped route serves every journey step', async () => {
  const fixture = serverActionsPage();
  const actions = await routeStepped(
    fixture.page as never,
    'https://room',
    (request) => request.method() === 'POST',
  );
  const passed = actionRoute('a');
  await fixture.deliver(passed);
  const seen: unknown[] = [];
  actions.use(async (route) => {
    seen.push(route);
  });
  const stepped = actionRoute('a');
  const document = actionRoute(undefined, 'GET');
  await fixture.deliver(stepped);
  await fixture.deliver(document);
  await actions.pass();
  const after = actionRoute('a');
  await fixture.deliver(after);
  assert({
    given: 'pass-through, then a step, then pass-through again',
    should:
      'keep one installed route, give the step only matching requests and fall back otherwise',
    actual: [
      fixture.routes(),
      passed.calls,
      seen,
      stepped.calls,
      document.calls,
      after.calls,
    ],
    expected: [1, ['fallback'], [stepped], [], ['fallback'], ['fallback']],
  });
});

test('passing through waits for a step already delivering', async () => {
  const fixture = serverActionsPage();
  const actions = await routeStepped(
    fixture.page as never,
    'https://room',
    (request) => request.method() === 'POST',
  );
  let release = () => {};
  actions.use(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const delivering = fixture.deliver(actionRoute('a'));
  let drained = false;
  const passing = actions.pass().then(() => {
    drained = true;
  });
  await Promise.resolve();
  const beforeRelease = drained;
  release();
  await Promise.all([delivering, passing]);
  assert({
    given: 'a step still holding a reply when the journey moves on',
    should: 'finish draining only after that reply is delivered',
    actual: [beforeRelease, drained],
    expected: [false, true],
  });
});
