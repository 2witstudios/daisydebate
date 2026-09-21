import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, isAppError } from '@daisy/errors';
import { fixedClock } from '@daisy/clock';
import { readServerConfig } from '@daisy/config';

setupRitewayBun();

const database: {
  createDebate: (record: { id: string }) => Promise<void>;
  getDebate: (id: string) => Promise<Record<string, unknown> | undefined>;
} = {
  createDebate: () => Promise.resolve(),
  getDebate: () => Promise.resolve(undefined),
};

const primitives = {
  clock: fixedClock('2026-01-01T00:00:00.000Z'),
  ids: { next: () => 'd5e8f2a4c6b1k3m7n9p2r4t6' },
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

const { createProofDebate, getProofDebate } = await import('./operations');

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
        primitives,
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
        primitives,
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
      primitives,
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
        id: 'd5e8f2a4c6b1k3m7n9p2r4t6',
        createdAt: '2026-01-01T00:00:00.000Z',
        persistedId: 'd5e8f2a4c6b1k3m7n9p2r4t6',
      },
    });
  });
});

describe('foundation debate retrieval', () => {
  test('restores the stored snapshot for a stored debate', async () => {
    const stored = await createProofDebate(
      { resolution: 'A representative resolution' },
      primitives,
    );
    database.getDebate = () =>
      Promise.resolve({
        id: stored.id,
        createdBy: null,
        resolution: stored.resolution,
        format: stored.format,
        snapshot: stored,
        version: 1,
        createdAt: stored.createdAt,
        updatedAt: stored.createdAt,
      });
    const restored = await getProofDebate(stored.id);

    assert({
      given: 'a stored debate snapshot',
      should: 'restore the runtime state from the durable record',
      actual: restored,
      expected: stored,
    });
  });

  test('answers a missing debate with NOT_FOUND', async () => {
    database.getDebate = () => Promise.resolve(undefined);
    const caught = await capture(getProofDebate('z9x7v5t3r1p8n6m4k2b5d7f1'));

    assert({
      given: 'a debate id matching no stored record',
      should: 'map the absence to a NOT_FOUND app error',
      actual: isAppError(caught) ? caught.code : 'not-an-app-error',
      expected: 'NOT_FOUND',
    });
  });

  test('refuses a principal without the proof permission', async () => {
    let reads = 0;
    database.getDebate = () => {
      reads += 1;
      return Promise.resolve(undefined);
    };
    const caught = await capture(
      getProofDebate('z9x7v5t3r1p8n6m4k2b5d7f1', {
        kind: 'service',
        serviceId: 'unprivileged',
        permissions: [],
      }),
    );

    assert({
      given: 'a principal lacking the proof permission',
      should: 'refuse with AUTHORIZATION before touching the database',
      actual: {
        code: isAppError(caught) ? caught.code : 'not-an-app-error',
        reads,
      },
      expected: { code: 'AUTHORIZATION', reads: 0 },
    });
  });
});
