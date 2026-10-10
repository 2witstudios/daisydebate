import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireLaunchReleaseServices } from '../e2e/support/room-launch-slot';
setupRitewayBun();
const slot = {
  id: 'proof',
  database: 'daisy_wt_proof_e2e',
  namespace: 'daisy-wt-proof-e2e',
  port: 13101,
};
const env = {
  DATABASE_URL: 'postgres://admin:local@localhost:5432/daisy_wt_proof',
  TEST_DATABASE_URL: 'postgres://test:local@localhost:5432/daisy_wt_proof_test',
  TEST_REDIS_URL: 'redis://localhost:6379/12',
  E2E_REDIS_URL: 'redis://localhost:6379/2',
};
const admitted = (url: string) => {
  try {
    return requireLaunchReleaseServices(slot, { ...env, REDIS_URL: url })
      .pathname;
  } catch {
    return 'refused';
  }
};
test('release accepts both canonical representations of Redis database zero only', () => {
  assert({
    given:
      'the canonical default Redis URL and its explicit database-zero equivalent',
    should: 'admit the same derived dev database without environment rewriting',
    actual: ['', '/0'].map((path) => admitted('redis://localhost:6379' + path)),
    expected: ['/daisy_wt_proof', '/daisy_wt_proof'],
  });
  assert({
    given: 'foreign Redis database numbers and invalid paths',
    should: 'refuse them before any service connection',
    actual: ['/1', '/2', '/12', '/00', '/not-a-database'].map((path) =>
      admitted('redis://localhost:6379' + path),
    ),
    expected: Array(5).fill('refused'),
  });
});

test('release refuses mismatched derived lifecycle endpoints', () => {
  const attempts = [
    {
      TEST_DATABASE_URL: env.TEST_DATABASE_URL.replace(
        'proof_test',
        'foreign_test',
      ),
    },
    { TEST_REDIS_URL: 'redis://localhost:6379/11' },
    { E2E_REDIS_URL: 'redis://localhost:6380/2' },
    { REDIS_URL: 'redis://remote.example:6379' },
  ];
  assert({
    given: 'a foreign test database, test Redis database, Redis port or host',
    should: 'refuse each target before opening a resource',
    actual: attempts.map((delta) => {
      try {
        requireLaunchReleaseServices(slot, {
          ...env,
          REDIS_URL: 'redis://localhost:6379',
          ...delta,
        });
        return 'admitted';
      } catch {
        return 'refused';
      }
    }),
    expected: Array(4).fill('refused'),
  });
});
