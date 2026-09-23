import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { assertRejects, rejectionOf } from '@daisy/errors/testing';
import type { Permission } from '@daisy/auth';
import { fixedClock } from '@daisy/clock';
import {
  createProofDebate,
  getProofDebate,
  proofPrincipal,
  type ProofDependencies,
} from './operations';

setupRitewayBun();

const foundationFormat = {
  id: 'foundation',
  rules: {
    version: 1 as const,
    seats: { affirmative: 1, negative: 1, judge: 0 },
    clock: { speechMs: 240_000, prepMs: 120_000 },
  },
  rankedEligible: false,
};

const database: {
  createDebate: (record: { id: string }) => Promise<void>;
  getDebate: (id: string) => Promise<Record<string, unknown> | undefined>;
  getFormat: (id: string) => Promise<typeof foundationFormat | null>;
} = {
  createDebate: () => Promise.resolve(),
  getDebate: () => Promise.resolve(undefined),
  getFormat: () => Promise.resolve(foundationFormat),
};

const primitives = {
  clock: fixedClock('2026-01-01T00:00:00.000Z'),
  ids: { next: () => 'd5e8f2a4c6b1k3m7n9p2r4t6' },
};

// The fake answers loosely shaped rows; the operations read only what they use.
const asDatabase = (fake: object) =>
  fake as unknown as ProofDependencies['database'];
const dependencies: ProofDependencies = {
  enabled: true,
  database: asDatabase(database),
  ...primitives,
};

describe('foundation operation error mapping', () => {
  test('wraps coded adapter failures as infrastructure errors', async () => {
    database.createDebate = () =>
      Promise.reject(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ERR_POSTGRES_CONNECTION_REFUSED',
        }),
      );
    await assertRejects({
      given: 'a database driver error carrying a code property',
      should: 'map to an INFRASTRUCTURE app error',
      actual: () =>
        createProofDebate(
          { resolution: 'A representative resolution' },
          dependencies,
        ),
      code: 'INFRASTRUCTURE',
    });
  });

  test('preserves app errors raised by the adapter', async () => {
    database.createDebate = () => Promise.reject(createAppError('CONFLICT'));
    await assertRejects({
      given: 'an app error raised by the adapter',
      should: 'pass through with its code intact',
      actual: () =>
        createProofDebate(
          { resolution: 'A representative resolution' },
          dependencies,
        ),
      code: 'CONFLICT',
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
      dependencies,
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
      dependencies,
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
        mode: 'casual',
        phase: 'waiting',
        visibility: 'unlisted',
        startedAt: null,
        completedAt: null,
        outcome: null,
      });
    const restored = await getProofDebate(stored.id, dependencies);

    assert({
      given: 'a stored debate snapshot',
      should: 'restore the runtime state from the durable record',
      actual: restored,
      expected: stored,
    });
  });

  test('answers a missing debate with NOT_FOUND', async () => {
    database.getDebate = () => Promise.resolve(undefined);
    const caught = await rejectionOf(() =>
      getProofDebate('z9x7v5t3r1p8n6m4k2b5d7f1', dependencies),
    );

    assert({
      given: 'a debate id matching no stored record',
      should: 'map the absence to a NOT_FOUND app error',
      actual: caught.code,
      expected: 'NOT_FOUND',
    });
  });

  test('refuses a principal holding only debate:create', async () => {
    const outcome = await readOfUnknownDebateAs('create-only', 'debate:create');
    assert({
      given: 'a principal holding debate:create but not debate:read',
      should: 'refuse with AUTHORIZATION before touching the database',
      actual: outcome,
      expected: { code: 'AUTHORIZATION', reads: 0 },
    });
  });

  test('admits a principal holding only debate:read', async () => {
    const outcome = await readOfUnknownDebateAs('read-only', 'debate:read');
    assert({
      given: 'a principal holding debate:read and an unknown debate id',
      should: 'pass the gate, read the database, and report NOT_FOUND',
      actual: outcome,
      expected: { code: 'NOT_FOUND', reads: 1 },
    });
  });
});

/**
 * A read of an unknown debate by a service principal holding one
 * permission: the rejection code and how many database reads it made.
 */
async function readOfUnknownDebateAs(
  serviceId: string,
  permission: Permission,
) {
  let reads = 0;
  database.getDebate = () => {
    reads += 1;
    return Promise.resolve(undefined);
  };
  const { code } = await rejectionOf(() =>
    getProofDebate('z9x7v5t3r1p8n6m4k2b5d7f1', dependencies, {
      kind: 'service',
      serviceId,
      permissions: [permission],
    }),
  );
  return { code, reads };
}

describe('foundation debate creation gate', () => {
  test('refuses a principal holding only debate:read', async () => {
    let writes = 0;
    database.createDebate = () => {
      writes += 1;
      return Promise.resolve();
    };
    const caught = await rejectionOf(() =>
      createProofDebate(
        { resolution: 'A representative resolution' },
        dependencies,
        {
          kind: 'service',
          serviceId: 'read-only',
          permissions: ['debate:read'],
        },
      ),
    );

    assert({
      given: 'a principal holding debate:read but not debate:create',
      should: 'refuse with AUTHORIZATION before touching the database',
      actual: {
        code: caught.code,
        writes,
      },
      expected: { code: 'AUTHORIZATION', writes: 0 },
    });
  });
});

describe('foundation proof gate', () => {
  test('answers NOT_FOUND for both operations when the injected flag is off', async () => {
    let touched = 0;
    const count = () => {
      touched += 1;
      return Promise.resolve(undefined);
    };
    const disabled = {
      ...dependencies,
      enabled: false,
      database: asDatabase({
        getFormat: () => count().then(() => foundationFormat),
        createDebate: () => count(),
        getDebate: () => count(),
      }),
    };
    const created = await rejectionOf(() =>
      createProofDebate(
        { resolution: 'A representative resolution' },
        disabled,
      ),
    );
    const read = await rejectionOf(() =>
      getProofDebate('z9x7v5t3r1p8n6m4k2b5d7f1', disabled),
    );

    assert({
      given: 'dependencies whose validated proof flag is off',
      should:
        'refuse create and read with NOT_FOUND before any database access',
      actual: {
        codes: [created, read].map((caught) => caught.code),
        touched,
      },
      expected: { codes: ['NOT_FOUND', 'NOT_FOUND'], touched: 0 },
    });
  });
});

describe('foundation proof principal', () => {
  test('holds exactly the create and read permissions', () => {
    assert({
      given: 'the hardcoded foundation proof service principal',
      should: 'hold debate:create and debate:read and nothing else, immutably',
      actual: {
        principal: proofPrincipal,
        frozen:
          Object.isFrozen(proofPrincipal) &&
          proofPrincipal.kind === 'service' &&
          Object.isFrozen(proofPrincipal.permissions),
      },
      expected: {
        principal: {
          kind: 'service',
          serviceId: 'foundation-proof',
          permissions: ['debate:create', 'debate:read'],
        },
        frozen: true,
      },
    });
  });
});
