import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveRoomConfiguration } from './resolve-room-configuration';
import {
  emptyCheckpoint,
  oneOnOneDefinition,
  practiceActors,
  practiceConfig,
  roundAt,
  runtimeWorld,
} from './runtime.test-support';

setupRitewayBun();

const at = roundAt;
const person = practiceActors.affirmative;

describe('round runtime prep', () => {
  test('runs elective prep for the prepping side only, folding elapsed into the budget', async () => {
    const world = runtimeWorld();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    world.tick(at(10_000 + 300_000)); // AC done by time; gap before CX1
    const refused = () =>
      world.execute({
        command: { type: 'start_prep' },
        actorId: person,
        now: at(310_000),
      });
    await assertRejects({
      given: 'prep before cross-examination, which the format never allows',
      should: 'refuse with the spendable-segment invariant',
      actual: refused,
      code: 'INVARIANT',
      invariantId: 'round.prep.requires-spendable-segment',
    });
    // After AC, CX1, NC and CX2 close by time, 1AR is the affirmative's
    // own speech; its countdown runs 940_000 to 950_000.
    world.tick(at(940_000));
    const prepared = world.execute({
      command: { type: 'start_prep' },
      actorId: person,
      now: at(945_000),
    });
    assert({
      given: "prep before the prepping side's own rebuttal",
      should: 'anchor the prep clock and clear the countdown',
      actual: {
        checkpoint: prepared.round?.checkpoint,
        position: world.position(at(955_000)),
      },
      expected: {
        checkpoint: {
          version: 1,
          prep_consumed_ms: { affirmative: 0, negative: 0 },
          active_prep: { side: 'affirmative', started_at: at(945_000) },
          floor: null,
        },
        position: {
          ...world.position(at(955_000)),
          stage: 'prep',
          prep: { side: 'affirmative', remainingMs: 230_000 },
          countdownRemainingMs: null,
        },
      },
    });
    const spoken = world.execute({
      command: { type: 'start_speech' },
      actorId: person,
      now: at(1_005_000),
    });
    assert({
      given: 'start_speech sixty seconds into prep',
      should: 'fold the elapsed prep and open the segment',
      actual: {
        consumed: spoken.round?.checkpoint.prep_consumed_ms,
        insert: spoken.segmentInserts[0]?.rulesSegmentKey,
      },
      expected: {
        consumed: { affirmative: 60_000, negative: 0 },
        insert: '1AR',
      },
    });
  });

  test('expires running prep at its remaining budget and opens the segment', () => {
    const ready = runtimeWorld();
    ready.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    ready.tick(at(940_000)); // AC, CX1, NC and CX2 closed; 1AR's countdown runs
    ready.execute({
      command: { type: 'start_prep' },
      actorId: person,
      now: at(945_000),
    });
    const expired = ready.tick(at(945_000 + 240_000));
    assert({
      given: 'the instant the whole budget is consumed',
      should: 'open the segment with the budget folded in full',
      actual: {
        consumed: expired.round?.checkpoint.prep_consumed_ms.affirmative,
        open: ready.position(at(945_000 + 240_000)).openSegment?.key,
        activePrep: expired.round?.checkpoint.active_prep,
      },
      expected: {
        consumed: 240_000,
        open: '1AR',
        activePrep: null,
      },
    });
  });

  test('refuses prep the resolved rules never granted a budget for', async () => {
    const withoutPrep = resolveRoomConfiguration(oneOnOneDefinition, {
      ...practiceConfig,
      inRoundPrep: { enabled: false },
    });
    if (!withoutPrep.ok) throw new Error(withoutPrep.refusal.message);
    const world = runtimeWorld({
      rules: withoutPrep.rules,
      checkpoint: null,
    });
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    const before = world.position(at(1_000));
    await assertRejects({
      given: 'a room whose config declined in-round prep',
      should: 'refuse with the prep-capability invariant',
      actual: () =>
        world.execute({
          command: { type: 'start_prep' },
          actorId: person,
          now: at(1_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.prep.requires-capability',
    });
    assert({
      given: 'the refused prep',
      should: 'leave the round counting down and unchanged',
      actual: world.position(at(1_000)),
      expected: before,
    });
  });

  test('refuses prep once the side has spent its whole budget', async () => {
    const world = runtimeWorld({
      status: 'active',
      checkpoint: {
        ...emptyCheckpoint,
        prep_consumed_ms: { affirmative: 240_000, negative: 0 },
      },
    });
    const before = world.position(at(1_000));
    await assertRejects({
      given: 'a checkpoint holding a fully spent affirmative prep budget',
      should: 'refuse with the prep-budget invariant',
      actual: () =>
        world.execute({
          command: { type: 'start_prep' },
          actorId: person,
          now: at(1_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.prep.requires-budget',
    });
    assert({
      given: 'the refused prep',
      should: 'leave the round counting down and unchanged',
      actual: world.position(at(1_000)),
      expected: before,
    });
  });
});
