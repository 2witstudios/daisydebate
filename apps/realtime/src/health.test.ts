import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { checkReadiness, type ReadinessResources } from './health';

setupRitewayBun();

const healthyResources: ReadinessResources = {
  draining: false,
  database: {
    health: async () => true,
    checkListen: async () => true,
  },
  redis: { health: async () => true },
};

describe('checkReadiness', () => {
  test('reports ready when Postgres, LISTEN and Redis all answer', async () => {
    assert({
      given: 'a healthy database, LISTEN subscription and Redis',
      should: 'report ready with every check true',
      actual: await checkReadiness(healthyResources),
      expected: {
        ready: true,
        checks: { database: true, listen: true, redis: true },
      },
    });
  });

  test('reports unready when draining, even with every check healthy', async () => {
    assert({
      given: 'a draining process',
      should: 'report not ready despite healthy dependencies',
      actual: (await checkReadiness({ ...healthyResources, draining: true }))
        .ready,
      expected: false,
    });
  });

  test('reports unready and names the failing check when LISTEN rejects', async () => {
    const resources: ReadinessResources = {
      ...healthyResources,
      database: {
        health: async () => true,
        checkListen: async () => {
          throw new Error('LISTEN unavailable');
        },
      },
    };

    assert({
      given: 'a database that cannot LISTEN',
      should: 'report not ready with only the listen check false',
      actual: await checkReadiness(resources),
      expected: {
        ready: false,
        checks: { database: true, listen: false, redis: true },
      },
    });
  });

  test('reports unready when a check exceeds its timeout', async () => {
    const resources: ReadinessResources = {
      ...healthyResources,
      redis: {
        health: () =>
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(true), 50),
          ),
      },
    };

    assert({
      given: 'a Redis health check slower than the bound',
      should: 'report not ready rather than waiting indefinitely',
      actual: (await checkReadiness(resources, 5)).ready,
      expected: false,
    });
  });
});
