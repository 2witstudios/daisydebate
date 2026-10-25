import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { oneOnOneCast, runtimeWorld } from './runtime.test-support';
setupRitewayBun();
const { at, person, opponent, rules } = oneOnOneCast();
test('free CX commits both sides while ordered CX transfers exclusive speaking authority', async () => {
  for (const mode of ['ordered', 'free'] as const) {
    const world = runtimeWorld({
      rules: {
        ...rules,
        interaction: { ...rules.interaction, crossExMode: mode },
      },
    });
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    const opened = world.tick(at(330_000));
    const cx = opened.segmentInserts.find((s) => s.type === 'cross_ex')!;
    const grant = opened.speakingChanges?.find(
      (s) => s.kind === 'open' && s.segmentId === cx.id,
    );
    assert({
      given: `${mode} CX opened by the shared clock`,
      should: 'grant its resolved speaking participants',
      actual: grant?.kind === 'open' ? grant.participantIds.length : 0,
      expected: mode === 'free' ? 2 : 1,
    });
    const interrupt = world.execute({
      command: { type: 'interrupt' },
      actorId: person,
      now: at(331_000),
    });
    assert({
      given: `accepted interruption during ${mode} CX`,
      should:
        'transfer ordered authority while free eligibility stays unchanged',
      actual: interrupt.speakingChanges?.map((c) => c.kind),
      expected: mode === 'free' ? [] : ['close', 'open'],
    });
    const before = world.position(at(332_000));
    await assertRejects({
      given: 'the other speaker attempts yield after floor transfer',
      should: 'refuse even if free speech eligible',
      actual: () =>
        world.execute({
          command: { type: 'yield' },
          actorId: opponent,
          now: at(332_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
    assert({
      given: 'refused yield',
      should: 'preserve engine position',
      actual: world.position(at(332_000)),
      expected: before,
    });
  }
});
