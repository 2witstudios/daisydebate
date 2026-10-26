import { readServerConfig } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { launchWorkerPolicy } from '../e2e/support/room-launch-worker-policy';
setupRitewayBun();
test('the launch browser server configures the shared bot workers explicitly', () => {
  const policy = readServerConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy',
    REDIS_URL: 'redis://localhost:6379',
    PUBLIC_APP_URL: 'http://localhost:3000',
    ROUND_BOT_WORKER_POLICY: launchWorkerPolicy,
  }).ROUND_BOT_WORKER_POLICY;
  assert({
    given: 'the launch server worker policy through the real config decoder',
    should:
      'enable bounded control, speech and judging workers with explicit models',
    actual: {
      enabled: policy !== undefined,
      models: policy && Object.keys(policy.models).sort(),
    },
    expected: {
      enabled: true,
      models: ['cross_ex', 'judge', 'speech', 'tts'],
    },
  });
});
