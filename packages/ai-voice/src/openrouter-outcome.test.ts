import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createOpenRouter, isDefiniteProviderFailure } from './openrouter';

setupRitewayBun();

const outcome = async (
  fetch: Parameters<typeof createOpenRouter>[0]['fetch'],
  signal?: AbortSignal,
) =>
  createOpenRouter({ apiKey: 'key', fetch })
    .complete({
      model: 'openai/gpt-6-luna',
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 5,
      ...(signal ? { signal } : {}),
    })
    .then(
      () => 'answered',
      (error: unknown) =>
        isDefiniteProviderFailure(error) ? 'definite' : 'uncertain',
    );
const answering = (status: number) => async () =>
  new Response('refused', { status });

test('a request the vendor itself refused is a definite failure', async () => {
  const statuses = [400, 401, 403, 422, 429];
  assert({
    given: 'vendor refusals 400, 401, 403, 422 and 429',
    should: 'call each definite: the vendor did not serve it',
    actual: await Promise.all(statuses.map((s) => outcome(answering(s)))),
    expected: statuses.map(() => 'definite'),
  });
});

test('a timeout or gateway answer may follow a served call, so it is uncertain', async () => {
  const statuses = [408, 500, 502, 503, 504];
  assert({
    given: 'answers 408, 500, 502, 503 and 504',
    should:
      'call each uncertain: the vendor may have served and billed it (ISSUE-458-r1)',
    actual: await Promise.all(statuses.map((s) => outcome(answering(s)))),
    expected: statuses.map(() => 'uncertain'),
  });
});

test('only a call cancelled before it was sent is a definite cancellation', async () => {
  const before = new AbortController();
  before.abort();
  const during = new AbortController();
  assert({
    given:
      'a call cancelled before sending, one cancelled while the request was in flight, an unreachable vendor and an unreadable answer',
    should:
      'call only the first definite; the rest may have reached the vendor (ISSUE-458-r2)',
    actual: [
      await outcome(async () => Response.json({}), before.signal),
      await outcome(async () => {
        during.abort();
        throw new DOMException('aborted', 'AbortError');
      }, during.signal),
      await outcome(async () => {
        throw new TypeError('connection reset');
      }),
      await outcome(async () => new Response('not json', { status: 200 })),
    ],
    expected: ['definite', 'uncertain', 'uncertain', 'uncertain'],
  });
});
