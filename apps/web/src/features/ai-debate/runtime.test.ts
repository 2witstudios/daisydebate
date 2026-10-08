import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { setup } from './operations.test-support';

setupRitewayBun();

for (const variant of [
  'ranked',
  'casual',
  'human opponent',
  'human judge',
  'extra judge',
] as const) {
  test(`AI orchestration refuses a round with ${variant}`, async () => {
    const { operations, begin, store, calls, clock } = setup();
    const id = await begin();
    const durableRound = store.getRound;
    const original = structuredClone((await durableRound(id))!);
    const round = structuredClone(original);
    if (variant === 'ranked' || variant === 'casual')
      Object.assign(round, { competitionType: variant });
    else if (variant === 'extra judge')
      Object.assign(round, {
        participants: [
          ...round.participants,
          { id: 'extra', actorId: 'human-judge', role: 'judge', slot: 1 },
        ],
      });
    else
      Object.assign(round, {
        participants: round.participants.map((seat) =>
          seat.role === (variant === 'human judge' ? 'judge' : 'negative')
            ? { ...seat, actorId: 'human-other' }
            : seat,
        ),
      });
    store.getRound = async () => round;
    clock.advance(11);
    calls.length = 0;
    for (const operation of [
      () => operations.view({ actorId: 'actor-1', id }),
      () => operations.ballot({ actorId: 'actor-1', id }),
      () =>
        operations.command({
          actorId: 'actor-1',
          id,
          command: { type: 'abort' },
          expectedVersion: round.version,
        }),
      () =>
        operations.crossExamine({ actorId: 'actor-1', id, segmentIndex: 1 }),
      () =>
        operations.transcribe({
          actorId: 'actor-1',
          id,
          segmentIndex: 0,
          audioBase64: 'QUJDRA==',
          format: 'webm',
        }),
    ]) {
      await assertRejects({
        given: `a debater in a round with ${variant}`,
        should: 'refuse practice orchestration before driving the runtime',
        actual: operation,
        code: 'NOT_FOUND',
      });
    }
    assert({
      given: 'all refused operations',
      should: 'leave durable state unchanged and make no provider calls',
      actual: [await durableRound(id), calls],
      expected: [original, []],
    });
  });
}
