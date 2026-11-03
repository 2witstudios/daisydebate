import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  oneOnOneCast,
  oneOnOneSeats,
  runtimeWorld,
} from './runtime.test-support';
import { speakingParticipants } from './round-speaking';
setupRitewayBun();
const { at, person, rules } = oneOnOneCast();
test('Custom POI permits both sides to speak without transferring the scheduled floor', () => {
  const poi = {
    ...rules,
    interaction: {
      ...rules.interaction,
      interruptions: { allowed: 'open' as const, minRemainingMs: 0 },
    },
  };
  assert({
    given: 'open questioning during a speech or question period',
    should:
      'grant both debaters speaking permission and keep the judge excluded',
    actual: [0, 1].map((sequence) =>
      speakingParticipants(poi, oneOnOneSeats, sequence, null),
    ),
    expected: [0, 1].map(() =>
      oneOnOneSeats
        .filter((seat) => seat.role !== 'judge')
        .map((seat) => seat.id),
    ),
  });
});
test('cross-examination keeps both microphones open and refuses every interruption', async () => {
  const modes = [
    null,
    { allowed: 'disabled' as const, minRemainingMs: 0 },
    { allowed: 'enabled' as const, minRemainingMs: 0 },
    { allowed: 'open' as const, minRemainingMs: 0 },
  ];
  for (const interruptions of modes) {
    const policy = interruptions?.allowed ?? 'no';
    const world = runtimeWorld({
      rules: { ...rules, interaction: { ...rules.interaction, interruptions } },
    });
    world.activate({ at: at(0), now: at(0) });
    const opened = world.tick(at(330_000));
    const cx = opened.segmentInserts.find((s) => s.type === 'cross_ex')!;
    const grant = opened.speakingChanges?.find(
      (s) => s.kind === 'open' && s.segmentId === cx.id,
    );
    assert({
      given: `cross-examination opened by the clock under ${policy} interruption policy`,
      should: 'grant both debaters and not the judge',
      actual: grant?.kind === 'open' ? grant.participantIds : [],
      expected: oneOnOneSeats
        .filter((seat) => seat.role !== 'judge')
        .map((seat) => seat.id),
    });
    const before = world.position(at(331_000));
    await assertRejects({
      given: `an interrupt during cross-examination under ${policy} interruption policy`,
      should: 'refuse with the interrupt-policy invariant',
      actual: () =>
        world.execute({
          command: { type: 'interrupt' },
          actorId: person,
          now: at(331_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.interrupt.requires-policy',
    });
    await assertRejects({
      given: 'the respondent ending the questioner’s cross-examination',
      should: 'refuse: speaking is not the floor',
      actual: () =>
        world.execute({
          command: { type: 'yield' },
          actorId: person,
          now: at(331_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
    assert({
      given: 'refused commands',
      should: 'preserve engine position',
      actual: world.position(at(331_000)),
      expected: before,
    });
  }
});
