import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, isAppError } from '@daisy/errors';
import { readServerConfig } from '@daisy/config';

setupRitewayBun();

const database: {
  createDebate: (record: { id: string }) => Promise<void>;
  getDebate: (id: string) => Promise<undefined>;
} = {
  createDebate: () => Promise.resolve(),
  getDebate: () => Promise.resolve(undefined),
};

const identity = {
  id: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// Seed process-local resources before touching operations so this test never
// constructs real database or Redis clients.
Reflect.set(globalThis, 'daisyResources', {
  config: readServerConfig({
    NODE_ENV: 'test',
    FOUNDATION_PROOF_ENABLED: 'true',
    DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_NAMESPACE: 'test',
    PUBLIC_APP_URL: 'http://localhost:3000',
    APP_VERSION: 'test',
    GIT_COMMIT: 'test',
  }),
  database,
});

const { createProofDebate } = await import('./operations');

const capture = async (operation: Promise<unknown>): Promise<unknown> => {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
};

describe('foundation operation error mapping', () => {
  test('wraps coded adapter failures as infrastructure errors', async () => {
    database.createDebate = () =>
      Promise.reject(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ERR_POSTGRES_CONNECTION_REFUSED',
        }),
      );
    const caught = await capture(
      createProofDebate(
        { resolution: 'A representative resolution' },
        identity,
      ),
    );
    assert({
      given: 'a database driver error carrying a code property',
      should: 'map to an INFRASTRUCTURE app error',
      actual: isAppError(caught) ? caught.code : 'not-an-app-error',
      expected: 'INFRASTRUCTURE',
    });
  });

  test('preserves app errors raised by the adapter', async () => {
    database.createDebate = () => Promise.reject(createAppError('CONFLICT'));
    const caught = await capture(
      createProofDebate(
        { resolution: 'A representative resolution' },
        identity,
      ),
    );
    assert({
      given: 'an app error raised by the adapter',
      should: 'pass through with its code intact',
      actual: isAppError(caught) ? caught.code : 'not-an-app-error',
      expected: 'CONFLICT',
    });
  });
});

describe('foundation operation identity', () => {
  test('stamps the snapshot and durable record with the injected identity', async () => {
    let persistedId: string | undefined;
    database.createDebate = (record) => {
      persistedId = record.id;
      return Promise.resolve();
    };
    const snapshot = await createProofDebate(
      { resolution: 'A representative resolution' },
      identity,
    );
    assert({
      given: 'injected identity and timestamp',
      should: 'stamp the snapshot and durable record with them',
      actual: {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        persistedId,
      },
      expected: {
        id: identity.id,
        createdAt: identity.createdAt,
        persistedId: identity.id,
      },
    });
  });
});
