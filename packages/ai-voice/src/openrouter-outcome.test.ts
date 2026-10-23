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

test('only a refusal the vendor answered, or a call never sent, is a definite failure', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  assert({
    given:
      'a 503 answer, an unreachable vendor, an unreadable answer and a call cancelled before sending',
    should:
      'call the vendor answer and the unsent call definite, and the rest uncertain',
    actual: [
      await outcome(async () => new Response('busy', { status: 503 })),
      await outcome(async () => {
        throw new TypeError('connection reset');
      }),
      await outcome(async () => new Response('not json', { status: 200 })),
      await outcome(async () => Response.json({}), cancelled.signal),
    ],
    expected: ['definite', 'uncertain', 'uncertain', 'definite'],
  });
});
