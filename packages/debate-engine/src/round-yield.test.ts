import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveRoomConfiguration } from './resolve-room-configuration';
import {
  emptyCheckpoint,
  oneOnOneDefinition,
  oneOnOneCast,
  oneOnOneSettings,
  runtimeWorld as runtime,
} from './runtime.test-support';
import { teamActors, teamRules, teamWorld } from './team-round.test-support';

setupRitewayBun();

const { at, person, opponent } = oneOnOneCast();

// One-on-one at a 10 s countdown: AC 10s–310s, CX1 320s–440s (negative asks).
const started = (rules = oneOnOneCast().rules) => {
  const world = runtime({ rules });
  world.activate({ at: at(0), now: at(0) });
  return world;
};

describe('yield', () => {
  test('only the scheduled speaker ends a speech, returning unused time to prep', async () => {
    const world = runtime({
      status: 'active',
      checkpoint: {
        ...emptyCheckpoint,
        prep_consumed_ms: { affirmative: 100_000, negative: 0 },
      },
    });
    world.tick(at(20_000));
    await assertRejects({
      given: 'the negative trying to end the affirmative’s speech',
      should: 'refuse with the yield-floor invariant',
      actual: () =>
        world.execute({
          command: { type: 'yield', sequence: 0 },
          actorId: opponent,
          now: at(20_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
    const yielded = world.execute({
      command: { type: 'yield', sequence: 0 },
      actorId: person,
      now: at(250_000),
    });
    assert({
      given: 'the affirmative ending its constructive a minute early',
      should: 'close it now and return the minute to the affirmative’s prep',
      actual: {
        closedAt: yielded.segmentCloses[0]?.endedAt,
        consumed: yielded.round?.checkpoint.prep_consumed_ms,
      },
      expected: {
        closedAt: at(250_000),
        consumed: { affirmative: 40_000, negative: 0 },
      },
    });
  });

  test('ending cross-examination early returns no time to prep (INTX-8)', () => {
    const world = runtime({
      status: 'active',
      checkpoint: {
        version: 2,
        prep_consumed_ms: { affirmative: 0, negative: 100_000 },
        prep: { phase: 'idle' },
        point_of_information: { phase: 'none' },
        incident: { phase: 'none' },
        start_gate: null,
        clock_stops: [],
      },
    });
    world.tick(at(330_000)); // AC ran 10s–310s; CX1 runs 320s–440s
    const ended = world.execute({
      command: { type: 'yield', sequence: 1 },
      actorId: opponent,
      now: at(330_000),
    });
    assert({
      given: 'the negative asker ending CX1 with 110 s left',
      should: 'close it with the negative’s prep untouched',
      actual: {
        closedAt: ended.segmentCloses[0]?.endedAt,
        consumed: ended.round?.checkpoint.prep_consumed_ms,
      },
      expected: {
        closedAt: at(330_000),
        consumed: { affirmative: 0, negative: 100_000 },
      },
    });
  });

  test('the asker ends cross-examination even when speeches may not be yielded (INTX-9)', async () => {
    const outcome = resolveRoomConfiguration(oneOnOneDefinition, {
      ...oneOnOneSettings,
      yielding: { allowed: false, returnsTime: false },
    });
    if (!outcome.ok) throw new Error(outcome.refusal.message);
    const world = started(outcome.rules);
    world.tick(at(20_000));
    await assertRejects({
      given: 'the affirmative trying to end its speech under no-yield rules',
      should: 'refuse',
      actual: () =>
        world.execute({
          command: { type: 'yield', sequence: 0 },
          actorId: person,
          now: at(20_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
    world.tick(at(330_000));
    await assertRejects({
      given: 'the answering affirmative trying to end CX1',
      should: 'refuse: only the asker ends it',
      actual: () =>
        world.execute({
          command: { type: 'yield', sequence: 1 },
          actorId: person,
          now: at(330_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
    assert({
      given: 'the negative asker ending CX1 under the same rules',
      should: 'close it',
      actual: world.execute({
        command: { type: 'yield', sequence: 1 },
        actorId: opponent,
        now: at(331_000),
      }).segmentCloses[0]?.endedAt,
      expected: at(331_000),
    });
  });

  test('a person answering a bot asker may end cross-examination (INTX-9)', async () => {
    const world = teamWorld({ bots: ['aff2'] });
    world.activate({ at: at(0), now: at(0) });
    world.tick(at(900_000)); // CX 870s–1050s; the affirmative second (a bot) asks
    await assertRejects({
      given: 'the asker’s human partner trying to end it',
      should: 'refuse: the asking side is the bot’s',
      actual: () =>
        world.execute({
          command: { type: 'yield', sequence: 2 },
          actorId: teamActors.aff1,
          now: at(900_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
    assert({
      given: 'a negative answering the bot ending it',
      should: 'close it',
      actual: world.execute({
        command: { type: 'yield', sequence: 2 },
        actorId: teamActors.neg2,
        now: at(900_000),
      }).segmentCloses[0]?.endedAt,
      expected: at(900_000),
    });
    const human = teamWorld({ rules: teamRules() });
    human.activate({ at: at(0), now: at(0) });
    human.tick(at(900_000));
    await assertRejects({
      given: 'a negative answering a human asker trying to end it',
      should: 'refuse',
      actual: () =>
        human.execute({
          command: { type: 'yield', sequence: 2 },
          actorId: teamActors.neg2,
          now: at(900_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
  });

  test('a late End naming the cross-examination never closes the next speech (INTX-7)', async () => {
    const outcome = resolveRoomConfiguration(oneOnOneDefinition, {
      ...oneOnOneSettings,
      speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
    });
    if (!outcome.ok) throw new Error(outcome.refusal.message);
    const world = started(outcome.rules);
    // No countdown: AC 0–300s, CX1 300s–420s (negative asks), NC 420s–780s (negative).
    world.tick(at(400_000));
    await assertRejects({
      given: 'the asker’s End for CX1 arriving after CX1 ran out, NC live',
      should: 'refuse as stale instead of ending the asker’s own constructive',
      actual: () =>
        world.execute({
          command: { type: 'yield', sequence: 1 },
          actorId: opponent,
          now: at(421_000),
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the position after the refusal',
      should: 'keep NC running',
      actual: world.position(at(421_000)).openSegment?.key,
      expected: 'NC',
    });
  });

  test('a press in the gap naming a segment that already closed is stale, not illegal (INTX-7)', async () => {
    const world = started();
    // A 10 s countdown: AC 10s–310s, CX1 320s–440s, then the gap before NC.
    world.tick(at(440_500));
    await assertRejects({
      given: 'the asker’s End for CX1 arriving in the gap after CX1 ran out',
      should: 'refuse it as a conflict the clock moved past',
      actual: () =>
        world.execute({
          command: { type: 'yield', sequence: 1 },
          actorId: opponent,
          now: at(440_500),
        }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'a point of information naming the closed AC, pressed in the gap',
      should: 'refuse it as a conflict too',
      actual: () =>
        world.execute({
          command: { type: 'offer_poi', sequence: 0 },
          actorId: opponent,
          now: at(440_500),
        }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'an End naming NC, a segment not yet opened',
      should: 'still refuse it as an illegal move',
      actual: () =>
        world.execute({
          command: { type: 'yield', sequence: 2 },
          actorId: opponent,
          now: at(440_500),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
  });
});
