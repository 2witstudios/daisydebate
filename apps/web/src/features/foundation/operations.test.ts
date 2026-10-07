import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import type { Permission } from '@daisy/auth';
import { fixedClock } from '@daisy/clock';
import type { RoundHydration } from '@daisy/db';
import { foundationDefinition } from '@daisy/db/reference-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  createProofDebate,
  getProofDebate,
  proofPrincipal,
  type ProofDependencies,
} from './operations';

setupRitewayBun();

const proofConfig = {
  preRoundPrep: { enabled: false },
  inRoundPrep: { enabled: true, budgetMsPerSide: 120_000 },
  speechTiming: { countdownMs: 10_000, segmentDurationOverrides: {} },
  crossExamination: { crossExMode: 'ordered' },
  interruptions: null,
  yielding: null,
} as const;

const resolved = resolveRoomConfiguration(foundationDefinition, proofConfig);
if (!resolved.ok) throw new Error(resolved.refusal.message);

const foundationFormat = {
  id: 'foundation',
  name: 'Foundation (architectural proof)',
  version: 1,
  definition: foundationDefinition,
};

const storedRound: RoundHydration = {
  id: 'd5e8f2a4c6b1k3m7n9p2r4t6',
  formatId: 'foundation',
  formatVersion: 1,
  resolution: 'A representative resolution',
  status: 'scheduled',
  currentStage: null,
  startedAt: null,
  completedAt: null,
  outcome: null,
  rules: resolved.rules,
  checkpoint: {
    version: 1,
    prep_consumed_ms: { affirmative: 0, negative: 0 },
    active_prep: null,
    floor: null,
  },
  version: 1,
  participants: [],
  segments: [],
};

const database: {
  createRound: (input: { id: string }) => Promise<void>;
  getRound: (id: string) => Promise<RoundHydration | null>;
  getFormat: (id: string) => Promise<typeof foundationFormat | null>;
} = {
  createRound: () => Promise.resolve(),
  getRound: () => Promise.resolve(null),
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
    database.createRound = () =>
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
    database.createRound = () => Promise.reject(createAppError('CONFLICT'));
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
  test('stamps the resolved round and durable record with the injected identity', async () => {
    let persistedId: string | undefined;
    database.createRound = (input) => {
      persistedId = input.id;
      return Promise.resolve();
    };
    const proof = await createProofDebate(
      { resolution: 'A representative resolution' },
      dependencies,
    );
    assert({
      given: 'injected identity and the one compiler',
      should: 'stamp the proof round and durable record with them',
      actual: {
        id: proof.id,
        format: proof.format,
        status: proof.status,
        segments: proof.rules.segments.length,
        persistedId,
      },
      expected: {
        id: 'd5e8f2a4c6b1k3m7n9p2r4t6',
        format: 'foundation',
        status: 'scheduled',
        segments: foundationDefinition.segments.length,
        persistedId: 'd5e8f2a4c6b1k3m7n9p2r4t6',
      },
    });
  });
});

describe('foundation debate retrieval', () => {
  test('reads the stored round through the same compiler output', async () => {
    const created = await createProofDebate(
      { resolution: 'A representative resolution' },
      dependencies,
    );
    database.getRound = () => Promise.resolve(storedRound);
    const restored = await getProofDebate(created.id, dependencies);
    assert({
      given: 'a stored round row',
      should: 'carry its frozen rules and resolution back out',
      actual: restored && {
        id: restored.id,
        resolution: restored.resolution,
        rules: restored.rules.version,
        status: restored.status,
      },
      expected: {
        id: storedRound.id,
        resolution: 'A representative resolution',
        rules: 2,
        status: 'scheduled',
      },
    });
  });

  test('answers a missing round with NOT_FOUND', async () => {
    database.getRound = () => Promise.resolve(null);
    await assertRejects({
      given: 'an id with no round behind it',
      should: 'answer NOT_FOUND',
      actual: () => getProofDebate('z9x7v5t3r1p8n6m4k2b5d7f1', dependencies),
      code: 'NOT_FOUND',
    });
  });

  test('admits a principal holding only debate:read', async () => {
    database.getRound = () => Promise.resolve(storedRound);
    const restored = await getProofDebate(storedRound.id, dependencies, {
      kind: 'service',
      serviceId: 'reader',
      permissions: ['debate:read'] as readonly Permission[],
    });
    assert({
      given: 'a principal holding only debate:read',
      should: 'admit the read',
      actual: restored?.id,
      expected: storedRound.id,
    });
  });
});

describe('the proof gate', () => {
  test('answers NOT_FOUND when the proof is disabled', async () => {
    const disabled = { ...dependencies, enabled: false };
    await assertRejects({
      given: 'a disabled proof',
      should: 'answer NOT_FOUND before any permission or database work',
      actual: () =>
        createProofDebate(
          { resolution: 'A representative resolution' },
          disabled,
        ),
      code: 'NOT_FOUND',
    });
    await assertRejects({
      given: 'a disabled proof asked for a stored round',
      should: 'answer NOT_FOUND',
      actual: () => getProofDebate('z9x7v5t3r1p8n6m4k2b5d7f1', disabled),
      code: 'NOT_FOUND',
    });
  });

  test('refuses a principal without the permission', async () => {
    await assertRejects({
      given: 'a principal without debate:create',
      should: 'refuse with AUTHORIZATION before touching the database',
      actual: () =>
        createProofDebate(
          { resolution: 'A representative resolution' },
          dependencies,
          {
            kind: 'service',
            serviceId: 'no-create',
            permissions: ['debate:read'] as readonly Permission[],
          },
        ),
      code: 'AUTHORIZATION',
    });
  });

  test('exposes the shared proof principal', () => {
    assert({
      given: 'the proof principal',
      should: 'be a service holding exactly create and read',
      actual: proofPrincipal,
      expected: {
        kind: 'service',
        serviceId: 'foundation-proof',
        permissions: ['debate:create', 'debate:read'],
      },
    });
  });
});
