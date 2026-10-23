import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  generationRun,
  requireRequest,
  requireRunUsage,
  requireSameSettlement,
  requireSpeechBudget,
  requireSpeechPolicy,
  requireUsage,
  type GenerationRequest,
} from './bot-generation-rules';

setupRitewayBun();

type Run = Parameters<typeof requireRunUsage>[0];
const run = (overrides: Record<string, unknown> = {}) =>
  ({
    kind: 'speech',
    characters: 0,
    inputTokens: 40,
    outputTokens: 12,
    configurationSnapshot: { providerOutcome: 'received' },
    ...overrides,
  }) as unknown as Run;
const usage = { inputTokens: 40, outputTokens: 12, characters: 0 };

test('a generation request is language or a non-empty speech', async () => {
  assert({
    given: 'a language request and a 120-character speech request',
    should: 'admit both',
    actual: [
      requireRequest({ kind: 'language' }),
      requireRequest({ kind: 'tts', characters: 120 }),
    ],
    expected: [undefined, undefined],
  });
  for (const request of [
    { kind: 'tts', characters: 0 },
    { kind: 'tts', characters: -1 },
    { kind: 'tts', characters: 1.5 },
    { kind: 'image' },
    null,
  ])
    await assertRejects({
      given: `the request ${JSON.stringify(request)}`,
      should: 'refuse it as invalid input',
      actual: () => requireRequest(request as unknown as GenerationRequest),
      code: 'VALIDATION',
    });
});

test('settled usage is a known outcome with non-negative integer counters', async () => {
  assert({
    given: 'each provider outcome with valid counters',
    should: 'admit them',
    actual: (['received', 'failed', 'unknown'] as const).map((outcome) =>
      requireUsage(outcome, usage),
    ),
    expected: [undefined, undefined, undefined],
  });
  for (const [outcome, counters] of [
    ['timeout', usage],
    ['received', { ...usage, inputTokens: -1 }],
    ['received', { ...usage, outputTokens: 2147483648 }],
    ['received', { ...usage, characters: 0.5 }],
  ] as const)
    await assertRejects({
      given: `${outcome} with ${JSON.stringify(counters)}`,
      should: 'refuse the settlement',
      actual: () =>
        requireUsage(outcome as Parameters<typeof requireUsage>[0], counters),
      code: 'VALIDATION',
    });
});

test('speech settles its reserved characters and no tokens; language no characters', async () => {
  const speech = run({ kind: 'tts', characters: 120 });
  assert({
    given: 'speech with its exact characters and language with tokens only',
    should: 'admit both',
    actual: [
      requireRunUsage(speech, {
        inputTokens: 0,
        outputTokens: 0,
        characters: 120,
      }),
      requireRunUsage(run(), usage),
    ],
    expected: [undefined, undefined],
  });
  for (const [label, candidate, counters] of [
    [
      'speech with other characters',
      speech,
      { ...usage, characters: 119, inputTokens: 0, outputTokens: 0 },
    ],
    ['speech with tokens', speech, { ...usage, characters: 120 }],
    ['language with characters', run(), { ...usage, characters: 1 }],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the settlement',
      actual: () => requireRunUsage(candidate, counters),
      code: 'VALIDATION',
    });
});

test('a settled run accepts only the identical settlement again', async () => {
  assert({
    given: 'the same outcome and counters',
    should: 'accept the retry',
    actual: requireSameSettlement(run(), 'received', usage),
    expected: undefined,
  });
  for (const [outcome, counters] of [
    ['failed', usage],
    ['received', { ...usage, inputTokens: 41 }],
    ['received', { ...usage, outputTokens: 11 }],
    ['received', { ...usage, characters: 1 }],
  ] as const)
    await assertRejects({
      given: `a retry settling ${outcome} with ${JSON.stringify(counters)}`,
      should: 'refuse the changed settlement',
      actual: () => requireSameSettlement(run(), outcome, counters),
      code: 'CONFLICT',
    });
});

test('speech needs an explicit model and stays within the seat budget', async () => {
  assert({
    given: 'an explicit model and budget, and speech that exactly fills it',
    should: 'return the model and admit the speech',
    actual: [
      requireSpeechPolicy({ ttsModel: 'voice-1', speechBudget: 1000 }),
      requireSpeechBudget(880, 120, 1000),
    ],
    expected: ['voice-1', undefined],
  });
  for (const policy of [
    {},
    { ttsModel: ' ', speechBudget: 1000 },
    { ttsModel: 'voice-1' },
    { ttsModel: 'voice-1', speechBudget: 0 },
    { ttsModel: 'voice-1', speechBudget: 1.5 },
  ])
    await assertRejects({
      given: `the speech policy ${JSON.stringify(policy)}`,
      should: 'refuse speech until the policy is explicit',
      actual: () => requireSpeechPolicy(policy),
      code: 'INFRASTRUCTURE',
    });
  await assertRejects({
    given: 'speech one character over the seat budget',
    should: 'refuse it as exhausted',
    actual: () => requireSpeechBudget(881, 120, 1000),
    code: 'CONFLICT',
  });
});

test('speech runs as tts and language keeps the worker kind', () => {
  assert({
    given: 'a speech request and language requests from both worker kinds',
    should: 'choose the run kind and reserved characters',
    actual: [
      generationRun({ kind: 'tts', characters: 120 }, 'speech'),
      generationRun({ kind: 'language' }, 'speech'),
      generationRun({ kind: 'language' }, 'cross_ex'),
    ],
    expected: [
      { kind: 'tts', characters: 120 },
      { kind: 'speech', characters: 0 },
      { kind: 'cross_ex', characters: 0 },
    ],
  });
});
