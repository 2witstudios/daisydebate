import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createOpenRouter } from '@daisy/ai-voice';
import { createBotGeneration } from './generation';
import { scope } from './speaker.test-support';
setupRitewayBun();

/** The settlement one failed 4-character voice call records. */
async function settlementOf(
  fetch: Parameters<typeof createOpenRouter>[0]['fetch'],
  abortAfterBegin = false,
) {
  const settled: unknown[] = [];
  const controller = new AbortController();
  const generation = createBotGeneration({
    store: {
      beginRoundBotGeneration: (async () => {
        if (abortAfterBegin) controller.abort();
        return {
          execution: 'execution',
          model: 'model',
          profile: { voice: 'voice' },
        };
      }) as never,
      finishRoundBotGeneration: async (_scope, _execution, outcome, usage) => {
        settled.push([outcome, usage.characters]);
      },
      verifyRoundBotPublication: async () => {},
    },
    voice: () => createOpenRouter({ apiKey: 'key', fetch }),
    withProvider: (_signal, work) => work(),
    nowMs: () => 0,
    maxTokens: 100,
  });
  await generation
    .synthesize(scope, 'token', 'p'.repeat(24), 'One.', controller.signal)
    .catch(() => undefined);
  return settled;
}

test('a voice call settles failed with no usage only when it certainly was not served', async () => {
  assert({
    given:
      'a vendor that refuses the request (400), a call cancelled before it reaches the vendor, and an unreachable vendor',
    should:
      'settle the first two as failed with no characters, and the uncertain one as unknown, keeping its characters',
    actual: [
      await settlementOf(async () => new Response('refused', { status: 400 })),
      await settlementOf(async () => Response.json({}), true),
      await settlementOf(async () => {
        throw new TypeError('connection reset');
      }),
    ],
    expected: [[['failed', 0]], [['failed', 0]], [['unknown', 4]]],
  });
});
