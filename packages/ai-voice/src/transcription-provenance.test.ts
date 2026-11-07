import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createOpenRouter } from './openrouter';
setupRitewayBun();
const transcribe = (body: unknown, generationId?: string) =>
  createOpenRouter({
    apiKey: 'unit-only',
    fetch: async () =>
      Response.json(body, {
        headers:
          generationId === undefined ? {} : { 'x-generation-id': generationId },
      }),
  }).transcribe({
    model: 'controlled-model',
    audioBase64: 'AA==',
    format: 'wav',
  });
test('transcription retains bounded actual provider usage and generation identity without invented defaults', async () => {
  const usage = {
    seconds: 1.2,
    total_tokens: 4,
    input_tokens: 3,
    output_tokens: 1,
    cost: 0.001,
  };
  assert({
    given: 'documented optional provider response metadata',
    should: 'preserve supplied values as reported provenance only',
    actual: await transcribe({ text: ' I affirm. ', usage }, 'gen-controlled'),
    expected: {
      text: 'I affirm.',
      generationId: 'gen-controlled',
      usage: {
        seconds: 1.2,
        totalTokens: 4,
        inputTokens: 3,
        outputTokens: 1,
        costUsd: 0.001,
      },
    },
  });
  assert({
    given: 'legacy response with no usage or generation header',
    should:
      'return text without fabricating receipt, usage or zero-cost billing',
    actual: await transcribe({ text: 'I affirm.' }),
    expected: { text: 'I affirm.' },
  });
});
for (const invalid of ['cost', 'tokens', 'nonfinite', 'identity'] as const)
  test(`transcription refuses malformed ${invalid} provenance`, async () => {
    const body = {
      text: 'Controlled text',
      usage: {
        seconds: 1,
        cost:
          invalid === 'cost' ? -1 : invalid === 'nonfinite' ? Infinity : 0.01,
        input_tokens: invalid === 'tokens' ? 0.5 : 2,
      },
    };
    await assertRejects({
      given: `${invalid} invalid provider metadata`,
      should:
        'refuse the malformed response rather than inventing valid provenance or dropping its contradiction',
      actual: () =>
        transcribe(
          body,
          invalid === 'identity' ? 'g'.repeat(257) : 'gen-controlled',
        ),
      code: 'INFRASTRUCTURE',
    });
  });
