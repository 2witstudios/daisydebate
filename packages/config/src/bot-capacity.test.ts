import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readServerConfig } from './index';
setupRitewayBun();
const env = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy',
  REDIS_URL: 'redis://localhost:6379',
  PUBLIC_APP_URL: 'http://localhost:3000',
};
test('AI Round admission requires an explicit server capacity bound', () => {
  assert({
    given: 'missing or explicit local proof capacity',
    should:
      'retain absence or the configured bound without an entitlement default',
    actual: [
      readServerConfig(env).AI_ROUND_BUSY_CAP,
      readServerConfig({ ...env, AI_ROUND_BUSY_CAP: '4' }).AI_ROUND_BUSY_CAP,
    ],
    expected: [undefined, 4],
  });
  for (const value of ['', '0', '-1', '1.5', 'Infinity', '9007199254740992'])
    expect(() =>
      readServerConfig({ ...env, AI_ROUND_BUSY_CAP: value }),
    ).toThrow('Invalid server configuration: AI_ROUND_BUSY_CAP');
});
test('the AI-round allowance is one flat trusted monthly cap', () => {
  assert({
    given: 'no cap, or an explicit cap within the protocol maximum',
    should: 'default to the beta cap of 20 and keep an explicit bound',
    actual: [
      readServerConfig(env).AI_ROUND_MONTHLY_CAP,
      readServerConfig({ ...env, AI_ROUND_MONTHLY_CAP: '1000' })
        .AI_ROUND_MONTHLY_CAP,
    ],
    expected: [20, 1000],
  });
  for (const value of ['', '0', '-1', '1.5', '1001', 'Infinity'])
    expect(() =>
      readServerConfig({ ...env, AI_ROUND_MONTHLY_CAP: value }),
    ).toThrow('Invalid server configuration: AI_ROUND_MONTHLY_CAP');
});
test('bot workers require a complete explicit bounded resource policy', () => {
  const policy = {
    maxControllers: 8,
    scanBatch: 8,
    scanMs: 250,
    leaseMs: 30000,
    renewMs: 5000,
    callTimeoutMs: 60000,
    models: {
      speech: 'anthropic/claude-sonnet-5.5',
      cross_ex: 'openai/gpt-6-luna',
      tts: 'deepgram/aura-2',
    },
  };
  assert({
    given: 'missing or explicitly configured worker resources',
    should: 'remain absent or retain every validated bound without defaults',
    actual: [
      readServerConfig(env).ROUND_BOT_WORKER_POLICY,
      readServerConfig({
        ...env,
        ROUND_BOT_WORKER_POLICY: JSON.stringify(policy),
      }).ROUND_BOT_WORKER_POLICY,
    ],
    expected: [undefined, policy],
  });
  for (const value of [
    '',
    '{}',
    JSON.stringify({ ...policy, scanMs: 501 }),
    JSON.stringify({ ...policy, renewMs: 15000 }),
    JSON.stringify({ ...policy, providerConcurrency: 2 }),
    JSON.stringify({ ...policy, models: { ...policy.models, judge: 'x' } }),
    JSON.stringify({ ...policy, models: { ...policy.models, tts: '' } }),
    JSON.stringify({ ...policy, inferredPremium: true }),
  ]) {
    expect(() =>
      readServerConfig({ ...env, ROUND_BOT_WORKER_POLICY: value }),
    ).toThrow('Invalid server configuration: ROUND_BOT_WORKER_POLICY');
  }
});

test('AI judging and round analysis each have their own policy, and competitive work its own budget', () => {
  const judging = {
    scanBatch: 8,
    scanMs: 250,
    leaseMs: 15000,
    renewMs: 3000,
    callTimeoutMs: 30000,
    model: 'anthropic/claude-sonnet-5.5',
  };
  const analysis = {
    concurrency: 1,
    scanBatch: 8,
    scanMs: 5000,
    leaseMs: 60000,
    callTimeoutMs: 45000,
    model: 'anthropic/claude-sonnet-5.5',
  };
  const read = (extra: Record<string, string>) =>
    readServerConfig({ ...env, ...extra });
  assert({
    given: 'no policies, then each set explicitly',
    should: 'leave each absent, then retain each without defaults',
    actual: [
      [
        read({}).ROUND_JUDGING_POLICY,
        read({}).ROUND_ANALYSIS_POLICY,
        read({}).COMPETITIVE_PROVIDER_CONCURRENCY,
      ],
      [
        read({ ROUND_JUDGING_POLICY: JSON.stringify(judging) })
          .ROUND_JUDGING_POLICY,
        read({ ROUND_ANALYSIS_POLICY: JSON.stringify(analysis) })
          .ROUND_ANALYSIS_POLICY,
        read({ COMPETITIVE_PROVIDER_CONCURRENCY: '2' })
          .COMPETITIVE_PROVIDER_CONCURRENCY,
      ],
    ],
    expected: [
      [undefined, undefined, undefined],
      [judging, analysis, 2],
    ],
  });
  for (const [key, value] of [
    ['ROUND_JUDGING_POLICY', JSON.stringify({ ...judging, renewMs: 9000 })],
    ['ROUND_JUDGING_POLICY', JSON.stringify({ ...judging, models: {} })],
    ['ROUND_ANALYSIS_POLICY', JSON.stringify({ ...analysis, concurrency: 0 })],
    [
      'ROUND_ANALYSIS_POLICY',
      JSON.stringify({ ...analysis, providerConcurrency: 2 }),
    ],
    ['COMPETITIVE_PROVIDER_CONCURRENCY', '0'],
  ] as const)
    expect(() => read({ [key]: value })).toThrow(
      `Invalid server configuration: ${key}`,
    );
});
