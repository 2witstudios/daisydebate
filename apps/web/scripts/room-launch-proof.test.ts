import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireLaunchSlot } from '../e2e/support/room-launch-slot';
setupRitewayBun();
const own = {
  E2E_DATABASE_URL:
    'postgres://runtime:local@localhost:5432/daisy_wt_proof_e2e',
  E2E_REDIS_URL: 'redis://localhost:6379/2',
  E2E_REDIS_NAMESPACE: 'daisy-wt-proof-e2e',
  E2E_PORT: '13101',
};
const refusal = (checkout: string, env = own) => {
  try {
    requireLaunchSlot(checkout, env);
    return 'accepted';
  } catch (error) {
    return error instanceof Error ? error.message : 'unknown';
  }
};
test('Launch proof refuses main, foreign databases, namespaces and remote services before opening resources', () => {
  assert({
    given: 'main, cross-slot and remote proof targets',
    should: 'refuse each target before any database or Redis connection',
    actual: [
      refusal('/repo'),
      refusal('/repo/wt-proof', {
        ...own,
        E2E_DATABASE_URL: own.E2E_DATABASE_URL.replace(
          'proof_e2e',
          'parent_e2e',
        ),
      }),
      refusal('/repo/wt-proof', { ...own, E2E_REDIS_NAMESPACE: 'daisy-e2e' }),
      refusal('/repo/wt-proof', {
        ...own,
        E2E_DATABASE_URL: own.E2E_DATABASE_URL.replace(
          'localhost',
          'remote.example',
        ),
      }),
    ],
    expected: Array(4).fill(
      'Launch proof requires its dedicated native worktree slot',
    ),
  });
});
test('Launch proof derives a single native suite-owned identity', () => {
  assert({
    given: 'matching own native worktree services',
    should: 'return only that worktree database, namespace and port',
    actual: requireLaunchSlot('/repo/wt-proof', own),
    expected: {
      id: 'proof',
      database: 'daisy_wt_proof_e2e',
      namespace: 'daisy-wt-proof-e2e',
      port: 13101,
    },
  });
});
