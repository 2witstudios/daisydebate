import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundStartPolicy } from '@daisy/protocol';
import { mediaGrants } from './media-grants';
import { resolveRoomConfiguration } from './resolve-room-configuration';
import {
  emptyCheckpoint,
  oneOnOneDefinition,
  oneOnOneActors,
  oneOnOneRules,
  oneOnOneSeats,
  oneOnOneSettings,
  roundAt,
  runtimeWorld,
} from './runtime.test-support';

setupRitewayBun();

const at = roundAt;
const person = oneOnOneActors.affirmative;
const lead = roundStartPolicy.microphoneLeadMs;

describe('round runtime prep', () => {
  test('runs elective prep for the prepping side only, folding elapsed into the budget', async () => {
    const world = runtimeWorld();
    world.activate({ at: at(0), now: at(0) });
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
          incident: { phase: 'none' },
          prep_ended_at: null,
          start_gate: null,
          clock_stops: [],
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
      should: 'fold the elapsed prep and start no clock yet',
      actual: {
        consumed: spoken.round?.checkpoint.prep_consumed_ms,
        prepEndedAt: spoken.round?.checkpoint.prep_ended_at,
        inserts: spoken.segmentInserts.length,
        startsIn: world.position(at(1_005_000)).countdownRemainingMs,
      },
      expected: {
        consumed: { affirmative: 60_000, negative: 0 },
        prepEndedAt: at(1_005_000),
        inserts: 0,
        startsIn: lead,
      },
    });
    const opened = world.tick(at(1_005_000 + lead));
    assert({
      given: 'one microphone lead after prep ended',
      should: 'start the clock and spend the lead',
      actual: {
        insert: opened.segmentInserts[0]?.rulesSegmentKey,
        startedAt: opened.segmentInserts[0]?.startedAt,
        prepEndedAt: opened.round?.checkpoint.prep_ended_at,
      },
      expected: {
        insert: '1AR',
        startedAt: at(1_005_000 + lead),
        prepEndedAt: null,
      },
    });
  });

  test('prep running out ends prep, then the clock starts one lead later', () => {
    const ready = runtimeWorld();
    ready.activate({ at: at(0), now: at(0) });
    ready.tick(at(940_000)); // AC, CX1, NC and CX2 closed; 1AR's countdown runs
    ready.execute({
      command: { type: 'start_prep' },
      actorId: person,
      now: at(945_000),
    });
    const ranOut = at(945_000 + 240_000);
    const expired = ready.tick(ranOut);
    assert({
      given: 'the instant the whole budget is consumed',
      should: 'fold the budget in full, end prep and start no clock yet',
      actual: {
        consumed: expired.round?.checkpoint.prep_consumed_ms.affirmative,
        activePrep: expired.round?.checkpoint.active_prep,
        prepEndedAt: expired.round?.checkpoint.prep_ended_at,
        open: ready.position(ranOut).openSegment,
        startsIn: ready.position(ranOut).countdownRemainingMs,
      },
      expected: {
        consumed: 240_000,
        activePrep: null,
        prepEndedAt: ranOut,
        open: null,
        startsIn: lead,
      },
    });
    assert({
      given: 'one microphone lead later',
      should: 'open the segment on the clock',
      actual: ready.tick(at(945_000 + 240_000 + lead)).segmentInserts[0]
        ?.startedAt,
      expected: at(945_000 + 240_000 + lead),
    });
  });

  test('no microphone opens during prep, and it opens for the lead after', () => {
    const world = runtimeWorld();
    world.activate({ at: at(0), now: at(0) });
    world.tick(at(940_000));
    world.execute({
      command: { type: 'start_prep' },
      actorId: person,
      now: at(945_000),
    });
    const seat = oneOnOneSeats.find((row) => row.actorId === person)!;
    const microphone = (ms: number) =>
      mediaGrants({
        participants: oneOnOneSeats.map((row) => ({
          ...row,
          eligible: true,
          kind: 'human' as const,
        })),
        participantId: seat.id,
        rules: oneOnOneRules(),
        position: world.position(at(ms)),
        now: at(ms),
        finalSegmentEndedAt: null,
        inPreRoundPrep: false,
        conversationHeld: true,
      }).publish.includes('microphone');
    const inPrep = microphone(1_000_000);
    world.execute({
      command: { type: 'start_speech' },
      actorId: person,
      now: at(1_005_000),
    });
    assert({
      given: 'a seat in its own prep, then the moment it ends prep',
      should: 'keep the microphone shut in prep and open it for the lead',
      actual: [inPrep, microphone(1_005_000)],
      expected: [false, true],
    });
  });

  test('a forfeit inside the lead leaves no prep end behind', () => {
    const world = runtimeWorld();
    world.activate({ at: at(0), now: at(0) });
    world.tick(at(940_000));
    world.execute({
      command: { type: 'start_prep' },
      actorId: person,
      now: at(945_000),
    });
    world.execute({
      command: { type: 'start_speech' },
      actorId: person,
      now: at(1_005_000),
    });
    const forfeited = world.execute({
      command: { type: 'forfeit' },
      actorId: person,
      now: at(1_005_100),
    });
    assert({
      given: 'a forfeit before the clock starts',
      should: 'end the Round with the prep end cleared',
      actual: forfeited.round?.checkpoint.prep_ended_at,
      expected: null,
    });
  });

  test('prep cannot restart inside the lead after it ended', async () => {
    const world = runtimeWorld();
    world.activate({ at: at(0), now: at(0) });
    world.tick(at(940_000));
    world.execute({
      command: { type: 'start_prep' },
      actorId: person,
      now: at(945_000),
    });
    world.execute({
      command: { type: 'start_speech' },
      actorId: person,
      now: at(1_005_000),
    });
    await assertRejects({
      given: 'start_prep inside the lead after prep ended',
      should: 'refuse, so the microphone already open stays open',
      actual: () =>
        world.execute({
          command: { type: 'start_prep' },
          actorId: person,
          now: at(1_005_100),
        }),
      code: 'CONFLICT',
    });
  });

  test('refuses prep the resolved rules never granted a budget for', async () => {
    const withoutPrep = resolveRoomConfiguration(oneOnOneDefinition, {
      ...oneOnOneSettings,
      inRoundPrep: { enabled: false },
    });
    if (!withoutPrep.ok) throw new Error(withoutPrep.refusal.message);
    const world = runtimeWorld({
      rules: withoutPrep.rules,
      checkpoint: null,
    });
    world.activate({ at: at(0), now: at(0) });
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

  test('exposes the checkpoint it executes against', () => {
    const world = runtimeWorld();
    assert({
      given: 'a fresh one-on-one world',
      should: 'parse its checkpoint with the runtime schema',
      actual: world.checkpoint(),
      expected: {
        version: 1,
        prep_consumed_ms: { affirmative: 0, negative: 0 },
        active_prep: null,
        floor: null,
        incident: { phase: 'none' },
        prep_ended_at: null,
        start_gate: null,
        clock_stops: [],
      },
    });
  });
});
