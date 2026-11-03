import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectionOf } from '@daisy/errors/testing';
import { fixedClock, sequentialId } from '@daisy/clock';
import { readServerConfig } from '@daisy/config';
import { AI_ROUND_MONTHLY_CAP_MAX } from '@daisy/protocol';
import { createApp } from './app';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
import { aiSeatAvailability, botAdmissionOptions } from './round-worker-policy';
setupRitewayBun();
const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
  REDIS_URL: 'redis://localhost:6379',
  REDIS_NAMESPACE: 'worker-config',
  PUBLIC_APP_URL: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
  COMPETITIVE_PROVIDER_CONCURRENCY: '2',
  ROUND_BOT_WORKER_POLICY: JSON.stringify({
    maxControllers: 4,
    scanBatch: 4,
    scanMs: 500,
    leaseMs: 15000,
    renewMs: 3000,
    callTimeoutMs: 10000,
    models: {
      speech: 'explicit-speech',
      cross_ex: 'explicit-cross',
      tts: 'explicit-tts',
    },
  }),
  ROUND_JUDGING_POLICY: JSON.stringify({
    scanBatch: 4,
    scanMs: 500,
    leaseMs: 15000,
    renewMs: 3000,
    callTimeoutMs: 10000,
    model: 'explicit-judge',
  }),
  ROUND_ANALYSIS_POLICY: JSON.stringify({
    concurrency: 1,
    scanBatch: 4,
    scanMs: 5000,
    leaseMs: 15000,
    callTimeoutMs: 45000,
    model: 'explicit-analysis',
  }),
};
test('configured bot worker policy requires an actual injected bearer producer', async () => {
  let app: ReturnType<typeof createApp> | undefined;
  try {
    assert({
      given:
        'explicit worker policy but no OS-CSPRNG capability at composition',
      should:
        'refuse rather than silently leave configured workers inert or infer a token',
      actual: await rejectionOf(() => {
        app = createApp({
          messagingPolicy: betaMessagingPolicy,
          env,
          fetch: async () => {
            throw Error('no network');
          },
          clock: fixedClock('2026-10-22T00:00:00.000Z'),
          ids: sequentialId('worker'),
        });
      }),
      expected: { code: 'INFRASTRUCTURE' },
    });
  } finally {
    await app?.close();
  }
});

const configuredOptions = async () => {
  const { readServerConfig } = await import('@daisy/config');
  const { roundWorkerDatabaseOptions } = await import('./round-worker-policy');
  return roundWorkerDatabaseOptions(readServerConfig(env), () =>
    'x'.repeat(43),
  );
};

test('worker composition supplies the explicit TTS model and retained per-seat speech budget', async () => {
  const options = await configuredOptions();
  assert({
    given: 'configured worker models at the real composition edge',
    should:
      'pass TTS policy explicitly without inferring member entitlement or Round busy capacity',
    actual: [
      options.botPublication?.ttsModel,
      options.botPublication?.speechBudget,
    ],
    expected: ['explicit-tts', 30000],
  });
});

test('judging and round analysis each read their own policy and model', async () => {
  const options = await configuredOptions();
  assert({
    given: 'configured judging and round analysis policies',
    should:
      'judge with the judging model, and analyse with the analysis model under a lease of its call timeout plus its lease',
    actual: {
      judging: [options.judging?.model, options.judging?.leaseMs],
      analysis: [options.roundAnalysis?.model, options.roundAnalysis?.leaseMs],
    },
    expected: {
      judging: ['explicit-judge', 15000],
      analysis: ['explicit-analysis', 60000],
    },
  });
});

test('an absent policy leaves only its own store absent', async () => {
  const { roundWorkerDatabaseOptions } = await import('./round-worker-policy');
  const options = roundWorkerDatabaseOptions(
    readServerConfig({ ...env, ROUND_ANALYSIS_POLICY: undefined }),
    () => 'x'.repeat(43),
  );
  assert({
    given: 'judging and bot policies with no round analysis policy',
    should: 'compose judging and bots and no round analysis store',
    actual: Object.keys(options).sort(),
    expected: ['botPublication', 'judging'],
  });
});

test('bot-debater admission composes the busy cap with the flat beta quota', () => {
  const approved = {
    userId: 'u'.repeat(24),
    actorId: 'a'.repeat(24),
    member: true,
    erased: false,
    revision: 1,
    beta: { state: 'approved' as const, revision: 1 },
    ageBand: 'adult' as const,
    restricted: false,
  };
  const configured = botAdmissionOptions({
    AI_ROUND_BUSY_CAP: 4,
    AI_ROUND_MONTHLY_CAP: 20,
  }).botAdmission;
  assert({
    given: 'no busy cap, then a busy cap with the default monthly cap',
    should:
      'admit no bot debater without a bound, else apply the cap only to an account holding an ai_rounds grant',
    actual: [
      botAdmissionOptions({ AI_ROUND_MONTHLY_CAP: 20 }),
      configured?.busyCap,
      configured?.allowance(approved, [
        { entitlement: 'ai_rounds', source: 'beta' },
      ]),
      configured?.allowance(approved, []),
    ],
    expected: [{}, 4, 20, null],
  });
});

test('the configurable cap ceiling is the Room contract ceiling', () => {
  const read = (AI_ROUND_MONTHLY_CAP: string) => {
    try {
      return readServerConfig({ ...env, AI_ROUND_MONTHLY_CAP })
        .AI_ROUND_MONTHLY_CAP;
    } catch {
      return 'refused';
    }
  };
  assert({
    given: 'a cap at and just above the protocol maximum',
    should: 'accept exactly what the botAdmission contract can carry',
    actual: [
      read(String(AI_ROUND_MONTHLY_CAP_MAX)),
      read(String(AI_ROUND_MONTHLY_CAP_MAX + 1)),
    ],
    expected: [AI_ROUND_MONTHLY_CAP_MAX, 'refused'],
  });
});

test('aiSeatAvailability()', () => {
  const bots = { models: {} } as never;
  const judging = { model: 'm' } as never;
  const provider = {
    OPENROUTER_API_KEY: 'key',
    COMPETITIVE_PROVIDER_CONCURRENCY: 2,
  };
  const full = {
    ...provider,
    ROUND_BOT_WORKER_POLICY: bots,
    ROUND_JUDGING_POLICY: judging,
    AI_ROUND_BUSY_CAP: 4,
    LIVEKIT_URL: 'http://livekit.invalid',
    LIVEKIT_PUBLIC_URL: 'ws://livekit.invalid',
    LIVEKIT_API_KEY: 'key',
    LIVEKIT_API_SECRET: 'secret',
  };
  assert({
    given: 'an OpenRouter key with no policy',
    should: 'offer neither seat',
    actual: aiSeatAvailability({ OPENROUTER_API_KEY: 'key' } as never),
    expected: { debater: false, judge: false },
  });
  assert({
    given: 'every bound, with and without the key',
    should: 'offer both seats only with the key',
    actual: [
      aiSeatAvailability(full as never),
      aiSeatAvailability({ ...full, OPENROUTER_API_KEY: undefined } as never),
    ],
    expected: [
      { debater: true, judge: true },
      { debater: false, judge: false },
    ],
  });
  assert({
    given: 'a judging policy alone, with the provider budget',
    should: 'offer the judge and not the debater',
    actual: aiSeatAvailability({
      ...provider,
      ROUND_JUDGING_POLICY: judging,
    } as never),
    expected: { debater: false, judge: true },
  });
  assert({
    given: 'everything but the media service',
    should: 'offer the judge, and not a debater that could not speak',
    actual: aiSeatAvailability({
      ...full,
      LIVEKIT_API_SECRET: undefined,
    } as never),
    expected: { debater: false, judge: true },
  });
  assert({
    given: 'a bot policy without its busy cap',
    should: 'not offer the debater',
    actual: aiSeatAvailability({
      ...provider,
      ROUND_BOT_WORKER_POLICY: bots,
    } as never).debater,
    expected: false,
  });
});
