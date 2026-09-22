import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createDebateRuntime,
  restoreDebateRuntime,
  rulesMatchFormat,
} from './index';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const second = 'a7b3c9d1e5f2k4m6n8p1r3t5';
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

describe('format rules', () => {
  test('rejects a seat the format does not offer', () => {
    const world = createDebateRuntime({
      id,
      resolution: 'A representative resolution',
      createdAt: '2026-01-01T00:00:00.000Z',
      format: 'solo-practice',
      rules: {
        ...foundationRules,
        seats: { affirmative: 1, negative: 0, judge: 0 },
      },
    });
    const before = world.snapshot();
    let error: unknown;
    try {
      world.join({ participantId: second, side: 'negative' });
    } catch (caught) {
      error = caught;
    }
    assert({
      given:
        'a format with no negative seat and a participant joining negative',
      should:
        'reject with the seats-within-format invariant and leave state unchanged',
      actual: {
        invariantId: (error as { invariantId?: string } | undefined)
          ?.invariantId,
        unchanged: world.snapshot(),
      },
      expected: {
        invariantId: 'debate.seats.within-format',
        unchanged: before,
      },
    });
    world.dispose();
  });

  test('keeps the effective rules in the snapshot across a round trip', () => {
    const world = create();
    assert({
      given: 'a runtime created with the foundation rules',
      should: 'carry format and rules verbatim through snapshot and restore',
      actual: (() => {
        const restored = restoreDebateRuntime(
          JSON.parse(JSON.stringify(world.snapshot())),
        );
        const snapshot = restored.snapshot();
        restored.dispose();
        return { format: snapshot.format, rules: snapshot.rules };
      })(),
      expected: { format: 'foundation', rules: foundationRules },
    });
    world.dispose();
  });

  test('tells canonical rules from a lobby override', () => {
    assert({
      given: 'the canonical foundation rules and a copy with a longer speech',
      should:
        'match the canonical copy and reject the override, regardless of key order',
      actual: [
        rulesMatchFormat(
          {
            clock: { prepMs: 120_000, speechMs: 240_000 },
            seats: { judge: 0, negative: 1, affirmative: 1 },
            version: 1,
          },
          foundationRules,
        ),
        rulesMatchFormat(
          { ...foundationRules, clock: { speechMs: 480_000, prepMs: 120_000 } },
          foundationRules,
        ),
      ],
      expected: [true, false],
    });
  });
});
