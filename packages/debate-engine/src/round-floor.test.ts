import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolveRoomConfiguration } from './resolve-room-configuration';
import {
  oneOnOneDefinition,
  practiceCast,
  practiceConfig,
  runtimeWorld as runtime,
} from './runtime.test-support';

setupRitewayBun();

const { at, opponent } = practiceCast();

test("an opponent's interrupt and yield never ends the scheduled speech (DEC-203)", async () => {
  const outcome = resolveRoomConfiguration(oneOnOneDefinition, {
    ...practiceConfig,
    interruptions: { mode: 'enabled', minRemainingMs: 30_000 },
  });
  if (!outcome.ok) throw new Error(outcome.refusal.message);
  const world = runtime({ rules: outcome.rules });
  world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
  world.tick(at(20_000)); // AC live, affirmative speaking
  const before = world.position(at(22_000)).openSegment;
  world.execute({
    command: { type: 'interrupt' },
    actorId: opponent,
    now: at(20_000),
  });
  const returned = world.execute({
    command: { type: 'yield' },
    actorId: opponent,
    now: at(21_000),
  });
  assert({
    given: 'the negative interrupting the affirmative speech, then yielding',
    should:
      'return the floor to the affirmative with the speech and its clock unchanged',
    actual: {
      closes: returned.segmentCloses,
      floor: returned.round?.checkpoint.floor,
      speaking: returned.speakingChanges
        ?.filter((change) => change.kind === 'open')
        .at(-1)?.participantIds,
      open: world.position(at(22_000)).openSegment,
    },
    expected: {
      closes: [],
      floor: null,
      speaking: ['m3w8k1z5c9b2n7p4r6t0v2x4'],
      open: before,
    },
  });
  await assertRejects({
    given: 'the negative yielding again without the floor',
    should: 'refuse with the yield-floor invariant',
    actual: () =>
      world.execute({
        command: { type: 'yield' },
        actorId: opponent,
        now: at(22_000),
      }),
    code: 'INVARIANT',
    invariantId: 'round.yield.requires-floor',
  });
});
