import type { APIResponse, BrowserContext } from '@playwright/test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rideRefusals, wasRidden } from '../e2e/support/ride-refusals';
setupRitewayBun();

type Answer = { readonly status: number; readonly retryAfter?: string };
const answer = ({ status, retryAfter }: Answer) =>
  ({
    status: () => status,
    headers: () =>
      retryAfter === undefined ? {} : { 'retry-after': retryAfter },
  }) as unknown as APIResponse;

/** A client whose answers are scripted; the last one repeats. */
const scripted = (answers: readonly Answer[]) => {
  let asks = 0;
  const context = {
    request: {
      fetch: async () => answer(answers[Math.min(asks++, answers.length - 1)]!),
    },
  } as unknown as Pick<BrowserContext, 'request'>;
  rideRefusals(context);
  return { request: context.request, asks: () => asks };
};
const refused = { status: 503, retryAfter: '0' };

test('a refusal that clears is asked again and marked', async () => {
  const { request, asks } = scripted([refused, { status: 200 }]);
  const response = await request.fetch('/api/rounds/a');
  assert({
    given: 'a refusal saying asking can clear it, then an answer',
    should: 'return the answer, marked as having ridden a refusal',
    actual: [response.status(), wasRidden(response), asks()],
    expected: [200, true, 2],
  });
});

test('a refusal that lasts still reaches the test', async () => {
  const { request, asks } = scripted([refused]);
  const response = await request.fetch('/api/rounds/a');
  assert({
    given: 'a refusal every time',
    should: 'stop after five asks and answer the 503',
    actual: [response.status(), wasRidden(response), asks()],
    expected: [503, true, 5],
  });
});

test('only a refusal that says so is asked again', async () => {
  const { request, asks } = scripted([{ status: 503 }]);
  const response = await request.fetch('/api/rounds/a');
  assert({
    given: 'a 503 with no Retry-After',
    should: 'answer it at once, unmarked',
    actual: [response.status(), wasRidden(response), asks()],
    expected: [503, false, 1],
  });
});

test('auth is never asked again', async () => {
  for (const path of [
    '/auth/confirm?token=t',
    '/api/auth/sign-in/magic-link',
  ]) {
    const { request, asks } = scripted([refused]);
    await request.fetch(path);
    assert({
      given: `${path}, whose one-time token a resend could spend`,
      should: 'ask once',
      actual: asks(),
      expected: 1,
    });
  }
});

test('a first answer is not marked', async () => {
  const { request } = scripted([{ status: 200 }]);
  const response = await request.fetch('/api/rounds/a');
  assert({
    given: 'an answer on the first ask',
    should: 'read as not ridden, so a bar may time against it',
    actual: wasRidden(response),
    expected: false,
  });
});
