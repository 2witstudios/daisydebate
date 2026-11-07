import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Page, Route } from '@playwright/test';
import { holdConversationResponses } from '../e2e/support/messaging-navigation-overlap';
setupRitewayBun();

test('held send diagnostics distinguish no interception, pending fetch and an actual outer response', async () => {
  const channel = 'c'.repeat(24);
  const fetched = Promise.withResolvers<{ status: () => number }>();
  const held = holdConversationResponses({} as Page, channel);
  const before = held.sendDiagnostic();
  const route = {
    request: () => ({
      url: () => `https://example.invalid/messages/${channel}`,
      method: () => 'POST',
      headers: () => ({ 'next-action': 'fixture' }),
    }),
    fetch: () => fetched.promise,
    fulfill: async () => {},
  } as unknown as Route;
  const work = held.intercept(route);
  const pending = held.sendDiagnostic();
  fetched.resolve({ status: () => 200 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const ready = held.sendDiagnostic();
  held.releaseAll();
  await work;
  assert({
    given:
      'no recognized request, then a recognized POST waiting for route.fetch, then its200response',
    should:
      'retain safe stage/count/status evidence without assuming a pending fetch committed',
    actual: [before, pending, ready].map((value) => ({
      sends: value.recognizedSends,
      started: value.fetchStarted,
      finished: value.fetchFinished,
      status: value.outerStatus,
      ready: value.sendReady,
    })),
    expected: [
      { sends: 0, started: false, finished: false, status: null, ready: false },
      { sends: 1, started: true, finished: false, status: null, ready: false },
      { sends: 1, started: true, finished: true, status: 200, ready: true },
    ],
  });
  assert({
    given: 'the fixture owns private channel and request data',
    should: 'project fixed stages only',
    actual: JSON.stringify(ready).includes(channel),
    expected: false,
  });
});

test('non200 held send keeps its outer status and still rejects the original expectation', async () => {
  const channel = 'c'.repeat(24);
  const held = holdConversationResponses({} as Page, channel);
  const route = {
    request: () => ({
      url: () => `https://example.invalid/messages/${channel}`,
      method: () => 'POST',
      headers: () => ({ 'next-action': 'fixture' }),
    }),
    fetch: async () => ({ status: () => 503 }),
  } as unknown as Route;
  const rejected = await held.intercept(route).then(
    () => false,
    () => true,
  );
  const snapshot = held.sendDiagnostic();
  assert({
    given: 'an actual outer503 finishes the recognized POST',
    should:
      'retain the status while failing rather than marking ready or swallowing the error',
    actual: {
      rejected,
      status: snapshot.outerStatus,
      ready: snapshot.sendReady,
      finished: snapshot.fetchFinished,
    },
    expected: { rejected: true, status: 503, ready: false, finished: true },
  });
});
