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
    providerConcurrency: 2,
    scanBatch: 8,
    scanMs: 250,
    leaseMs: 30000,
    renewMs: 5000,
    callTimeoutMs: 60000,
    models: {
      speech: 'anthropic/claude-sonnet-5.5',
      cross_ex: 'openai/gpt-6-luna',
      judge: 'anthropic/claude-sonnet-5.5',
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
    JSON.stringify({ ...policy, providerConcurrency: 0 }),
    JSON.stringify({ ...policy, models: { ...policy.models, judge: '' } }),
    JSON.stringify({ ...policy, inferredPremium: true }),
  ]) {
    expect(() =>
      readServerConfig({ ...env, ROUND_BOT_WORKER_POLICY: value }),
    ).toThrow('Invalid server configuration: ROUND_BOT_WORKER_POLICY');
  }
});
