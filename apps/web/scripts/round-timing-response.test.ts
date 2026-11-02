import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createResumedClockWitness,
  routeServerActions,
} from '../e2e/support/round-timing-response';

setupRitewayBun();

const CLOCK_ACTION = 'clock-action';
const CLOCK_BODY = Buffer.from('1:{"kind":"found","serverNowMs":20000}\n');
const mainFrame = { name: 'main' };

/**
 * A delivered Server Action at the route seam. The browser's own response is
 * unreadable, as in the e5 trace; only the fetched APIResponse carries bytes.
 */
const delivery = ({
  actionId = CLOCK_ACTION,
  method = 'POST',
  frame = mainFrame as object,
  body = CLOCK_BODY,
  status = 200,
  fetchFailure = null as Error | null,
} = {}) => {
  const calls: string[] = [];
  const fulfilled: { response: unknown; body: Buffer }[] = [];
  const response = {
    status: () => status,
    body: async () => body,
  };
  return {
    calls,
    fulfilled,
    response,
    route: {
      request: () => ({
        method: () => method,
        headers: () => ({ 'next-action': actionId }),
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
  createResumedClockWitness({
    actionId: CLOCK_ACTION,
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
  const others = [
    delivery({ actionId: 'transcript-action' }),
    delivery({ method: 'GET' }),
    delivery({ frame: { name: 'child' } }),
  ];
  for (const other of others) await witness.handle(other.route);
  documentEpoch.current = 4;
  const otherDocument = delivery();
  await witness.handle(otherDocument.route);
  assert({
    given:
      'requests before arming, of another action, method or frame, or from a later document',
    should: 'fall through unread and capture nothing',
    actual: [before, ...others, otherDocument].map(({ calls }) => calls),
    expected: Array.from({ length: 5 }, () => ['fallback']),
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
  const second = delivery({ body: Buffer.from('{"serverNowMs":30000}') });
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
  await witness.handle(
    delivery({ body: Buffer.from('{"kind":"unavailable"}') }).route,
  );
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

test('one Server Action route serves every journey step', async () => {
  const fixture = serverActionsPage();
  const actions = await routeServerActions(
    fixture.page as never,
    'https://room',
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
      'keep one installed route, give the step only Server Actions and fall back otherwise',
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
  const actions = await routeServerActions(
    fixture.page as never,
    'https://room',
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
