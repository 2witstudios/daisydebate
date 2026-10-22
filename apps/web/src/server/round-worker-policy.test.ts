import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectionOf } from '@daisy/errors/testing';
import { fixedClock, sequentialId } from '@daisy/clock';
import { createApp } from './app';
setupRitewayBun();
const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
  REDIS_URL: 'redis://localhost:6379',
  REDIS_NAMESPACE: 'worker-config',
  PUBLIC_APP_URL: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
  ROUND_BOT_WORKER_POLICY: JSON.stringify({
    maxControllers: 4,
    providerConcurrency: 1,
    scanBatch: 4,
    scanMs: 500,
    leaseMs: 15000,
    renewMs: 3000,
    callTimeoutMs: 10000,
    models: {
      speech: 'explicit-speech',
      cross_ex: 'explicit-cross',
      judge: 'explicit-judge',
      tts: 'explicit-tts',
    },
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
