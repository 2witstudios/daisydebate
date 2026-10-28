import { readServerConfig } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { launchWorkerEnv } from '../e2e/support/room-launch-worker-policy';
setupRitewayBun();
test('the launch browser server configures bot and judging workers explicitly, each under its own policy', () => {
  const config = readServerConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy',
    REDIS_URL: 'redis://localhost:6379',
    PUBLIC_APP_URL: 'http://localhost:3000',
    ...launchWorkerEnv,
  });
  assert({
    given: 'the launch server worker policy through the real config decoder',
    should:
      'enable bounded control, speech and judging workers with explicit models',
    actual: {
      botModels:
        config.ROUND_BOT_WORKER_POLICY &&
        Object.keys(config.ROUND_BOT_WORKER_POLICY.models).sort(),
      judging: config.ROUND_JUDGING_POLICY?.model,
      competitive: config.COMPETITIVE_PROVIDER_CONCURRENCY,
      analysis: config.ROUND_ANALYSIS_POLICY,
    },
    expected: {
      botModels: ['cross_ex', 'speech', 'tts'],
      judging: 'anthropic/claude-sonnet-5.5',
      competitive: 2,
      analysis: undefined,
    },
  });
});
