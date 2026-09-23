import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAdapter } from './ecs-adapter';
import { createDebateRuntime } from './index';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const foundationRules = {
  version: 1 as const,
  seats: { affirmative: 1, negative: 1, judge: 0 },
  clock: { speechMs: 240_000, prepMs: 120_000 },
};
const create = () =>
  createDebateRuntime({
    id,
    resolution: 'A representative resolution',
    createdAt: '2026-01-01T00:00:00.000Z',
    format: 'foundation',
    rules: foundationRules,
  });

const caught = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('ECS adapter ordering', () => {
  test('orders participants by UTF-16 code unit, never by locale', () => {
    // Locale collation puts 'a' before 'B'; code-unit order puts 'B' (0x42)
    // before 'a' (0x61). The adapter is fed directly so the pair is not
    // filtered by the cuid2 id shape the engine validates.
    const adapter = createAdapter({
      ...create().snapshot(),
      participants: [
        { id: 'a', side: 'affirmative', ready: false },
        { id: 'B', side: 'negative', ready: false },
      ],
    });
    assert({
      given: 'participant ids whose locale and code-unit orders differ',
      should: 'return them in code-unit order',
      actual: adapter.snapshot().participants.map((p) => p.id),
      expected: ['B', 'a'],
    });
    adapter.dispose();
  });
});

describe('ECS adapter failures', () => {
  test('rejects readiness before joining', () => {
    const world = create();
    const before = world.snapshot();
    const error = caught(() => world.markReady(id));
    assert({
      given: 'a readiness operation for a participant that never joined',
      should: 'identify the registered join-before-ready invariant',
      actual: (error as { invariantId?: string }).invariantId,
      expected: 'debate.participant.ready.requires-join',
    });
    assert({
      given: 'a rejected readiness operation',
      should: 'leave the snapshot unchanged',
      actual: world.snapshot(),
      expected: before,
    });
    world.dispose();
  });

  test('reports use after dispose as an internal fault, not a domain rule', () => {
    const world = create();
    world.dispose();
    const error = caught(() => world.snapshot());
    assert({
      given: 'a snapshot read from a disposed runtime',
      should: 'fail as INTERNAL without an invariant id',
      actual: {
        code: (error as { code?: string }).code,
        invariantId: (error as { invariantId?: string }).invariantId,
      },
      expected: { code: 'INTERNAL', invariantId: undefined },
    });
  });
});
