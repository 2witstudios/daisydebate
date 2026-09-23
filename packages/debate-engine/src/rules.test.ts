import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { restoreDebateRuntime, rulesMatchFormat } from './index';
import {
  create,
  foundationRules,
  id,
  second,
  soloRules,
} from './runtime.test-support';

setupRitewayBun();

describe('format rules', () => {
  test('rejects a seat the format does not offer', async () => {
    const world = create('solo-practice', soloRules);
    const before = world.snapshot();
    await assertRejects({
      given:
        'a format with no negative seat and a participant joining negative',
      should: 'reject with the seats-within-format invariant',
      actual: () => world.join({ participantId: second, side: 'negative' }),
      code: 'INVARIANT',
      invariantId: 'debate.seats.within-format',
    });
    assert({
      given: 'a join refused by the seats-within-format invariant',
      should: 'leave state unchanged',
      actual: world.snapshot(),
      expected: before,
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

  test('hands out a copy of the rules, never its own', () => {
    const world = create();
    const leaked = world.snapshot().rules;
    leaked.seats.negative = 0;
    leaked.clock.speechMs = 1;
    world.join({ participantId: second, side: 'negative' });
    assert({
      given: 'a caller that mutates the rules of a snapshot it was handed',
      should:
        'keep the runtime on its original rules: the negative seat is still offered and the clock is unchanged',
      actual: {
        rules: world.snapshot().rules,
        seated: world.snapshot().participants.map((p) => p.side),
      },
      expected: { rules: foundationRules, seated: ['negative'] },
    });
    world.dispose();
  });

  test('refuses more than one seat per side until slots are modelled', async () => {
    const world = create();
    await assertRejects({
      given: 'rules offering two affirmative seats',
      should:
        'reject with the capacity-supported invariant rather than seat one and silently refuse the other',
      actual: () =>
        restoreDebateRuntime({
          ...world.snapshot(),
          rules: {
            ...foundationRules,
            seats: { affirmative: 2, negative: 1, judge: 0 },
          },
        }),
      code: 'INVARIANT',
      invariantId: 'debate.seats.capacity-supported',
    });
    world.dispose();
  });

  test('starts when every offered seat is filled and ready', () => {
    const solo = create('solo-practice', soloRules);
    solo.join({ participantId: id, side: 'affirmative' });
    solo.markReady(id);
    solo.transition('active');
    assert({
      given:
        'a format with one affirmative seat and no negative seat, its seat filled and ready',
      should:
        'become active with one participant, because readiness derives from the rules',
      actual: {
        phase: solo.snapshot().phase,
        seated: solo.snapshot().participants.length,
      },
      expected: { phase: 'active', seated: 1 },
    });
    solo.dispose();
  });
});
