import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundStartPolicy } from '@daisy/protocol/round-start-policy';
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
import { teamActors, teamRules, teamWorld } from './team-round.test-support';

setupRitewayBun();

const at = roundAt;
const person = oneOnOneActors.affirmative;
const opponent = oneOnOneActors.negative;
const lead = roundStartPolicy.microphoneLeadMs;

// One-on-one at a 10 s countdown: AC 10s–310s, CX1 320s–440s, NC 450s–810s,
// CX2 820s–940s (affirmative asks), 1AR 950s–1250s, NR 1260s–1560s, 2AR 1570s–1750s.
const oneAR = 4;
const twoAR = 6;

const started = (rules = oneOnOneRules()) => {
  const world = runtimeWorld({ rules });
  world.activate({ at: at(0), now: at(0) });
  return world;
};

describe('round runtime prep', () => {
  test('runs elective prep for the prepping side only, folding elapsed into the budget', async () => {
    const world = started();
    world.tick(at(310_000)); // AC done by time; gap before CX1
    await assertRejects({
      given: 'prep before cross-examination, which the format never allows',
      should: 'refuse with the spendable-segment invariant',
      actual: () =>
        world.execute({
          command: { type: 'start_prep', sequence: 1 },
          actorId: opponent,
          now: at(310_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.prep.requires-spendable-segment',
    });
    world.tick(at(940_000));
    const prepared = world.execute({
      command: { type: 'start_prep', sequence: oneAR },
      actorId: person,
      now: at(945_000),
    });
    assert({
      given: "prep in the gap before the prepping side's own rebuttal",
      should: 'run prep from the press and clear the countdown',
      actual: {
        checkpoint: prepared.round?.checkpoint,
        position: world.position(at(955_000)),
      },
      expected: {
        checkpoint: {
          ...emptyCheckpoint,
          prep: {
            phase: 'running',
            side: 'affirmative',
            started_at: at(945_000),
          },
        },
        position: {
          ...world.position(at(955_000)),
          stage: 'prep',
          prep: { phase: 'running', side: 'affirmative', remainingMs: 230_000 },
          countdownRemainingMs: null,
        },
      },
    });
    const spoken = world.execute({
      command: { type: 'start_speech', sequence: oneAR },
      actorId: person,
      now: at(1_005_000),
    });
    assert({
      given: 'start_speech sixty seconds into prep',
      should: 'fold the elapsed prep, begin the lead and start no clock yet',
      actual: {
        consumed: spoken.round?.checkpoint.prep_consumed_ms,
        prep: spoken.round?.checkpoint.prep,
        inserts: spoken.segmentInserts.length,
        startsIn: world.position(at(1_005_000)).countdownRemainingMs,
      },
      expected: {
        consumed: { affirmative: 60_000, negative: 0 },
        prep: { phase: 'lead', ended_at: at(1_005_000) },
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
        prep: opened.round?.checkpoint.prep,
      },
      expected: {
        insert: '1AR',
        startedAt: at(1_005_000 + lead),
        prep: { phase: 'idle' },
      },
    });
  });

  test('prep called during the previous segment starts the instant it ends (INTX-2)', () => {
    const world = started();
    world.tick(at(900_000)); // CX2, which the affirmative asks, is live
    const called = world.execute({
      command: { type: 'start_prep', sequence: oneAR },
      actorId: person,
      now: at(900_000),
    });
    assert({
      given: 'the affirmative calling prep for its rebuttal while CX2 runs',
      should: 'hold the call without touching the live segment',
      actual: {
        prep: called.round?.checkpoint.prep,
        closes: called.segmentCloses.length,
        position: world.position(at(900_000)).prep,
      },
      expected: {
        prep: { phase: 'called', side: 'affirmative' },
        closes: 0,
        position: { phase: 'called', side: 'affirmative' },
      },
    });
    const late = world.tick(at(1_000_000)); // a late tick, 60 s after CX2 ended
    assert({
      given: 'a tick long after CX2 ran out',
      should: 'start prep at the exact close instant and skip the countdown',
      actual: {
        prep: late.round?.checkpoint.prep,
        closedAt: late.segmentCloses[0]?.endedAt,
        inserts: late.segmentInserts.length,
        position: world.position(at(1_000_000)).prep,
      },
      expected: {
        prep: {
          phase: 'running',
          side: 'affirmative',
          started_at: at(940_000),
        },
        closedAt: at(940_000),
        inserts: 0,
        position: {
          phase: 'running',
          side: 'affirmative',
          remainingMs: 180_000,
        },
      },
    });
  });

  test('a countdown of 0 still lets the next side prep (INTX-2)', async () => {
    const configured = resolveRoomConfiguration(oneOnOneDefinition, {
      ...oneOnOneSettings,
      speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
    });
    if (!configured.ok) throw new Error(configured.refusal.message);
    const world = started(configured.rules);
    // With no countdown: AC 0–300s, CX1 300s–420s, NC 420s–780s, CX2 780s–900s, 1AR 900s–1200s.
    world.tick(at(899_000));
    world.execute({
      command: { type: 'start_prep', sequence: oneAR },
      actorId: person,
      now: at(899_000),
    });
    const ended = world.tick(at(901_000));
    assert({
      given: 'prep called a second before CX2 ends, at no countdown',
      should: 'start prep at the close instead of opening the rebuttal',
      actual: {
        prep: ended.round?.checkpoint.prep,
        inserts: ended.segmentInserts.length,
      },
      expected: {
        prep: {
          phase: 'running',
          side: 'affirmative',
          started_at: at(900_000),
        },
        inserts: 0,
      },
    });
    const plain = started(configured.rules);
    plain.tick(at(900_000));
    await assertRejects({
      given: 'no call before CX2 ended, at no countdown',
      should: 'find the rebuttal already live and refuse a stale call',
      actual: () =>
        plain.execute({
          command: { type: 'start_prep', sequence: oneAR },
          actorId: person,
          now: at(900_000),
        }),
      code: 'CONFLICT',
    });
  });

  test('a called prep is cancelled by its side and the segment runs on', async () => {
    const world = started();
    world.tick(at(900_000));
    world.execute({
      command: { type: 'start_prep', sequence: oneAR },
      actorId: person,
      now: at(900_000),
    });
    await assertRejects({
      given: 'the other side trying to cancel it',
      should: 'refuse',
      actual: () =>
        world.execute({
          command: { type: 'cancel_prep', sequence: oneAR },
          actorId: opponent,
          now: at(901_000),
        }),
      code: 'CONFLICT',
    });
    const cancelled = world.execute({
      command: { type: 'cancel_prep', sequence: oneAR },
      actorId: person,
      now: at(902_000),
    });
    const after = world.tick(at(940_000));
    assert({
      given: 'the calling side cancelling, then CX2 ending',
      should: 'leave no prep and count down to the rebuttal as usual',
      actual: {
        prep: cancelled.round?.checkpoint.prep,
        stage: world.position(at(945_000)).stage,
        countdown: world.position(at(945_000)).countdownRemainingMs,
        closes: after.segmentCloses.length,
      },
      expected: {
        prep: { phase: 'idle' },
        stage: 'countdown',
        countdown: 5_000,
        closes: 1,
      },
    });
  });

  test('either partner calls and ends their side’s prep (INTX-2, INTX-3)', async () => {
    const world = teamWorld();
    world.activate({ at: at(0), now: at(0) });
    world.tick(at(1_000_000)); // CX live; 2A (aff slot 1) speaks next
    world.execute({
      command: { type: 'start_prep', sequence: 3 },
      actorId: teamActors.aff1,
      now: at(1_000_000),
    });
    world.tick(at(1_050_000)); // CX ends; prep runs from 1050s
    await assertRejects({
      given: 'the other side trying to end the affirmative’s prep',
      should: 'refuse',
      actual: () =>
        world.execute({
          command: { type: 'start_speech', sequence: 3 },
          actorId: teamActors.neg1,
          now: at(1_080_000),
        }),
      code: 'CONFLICT',
    });
    const ended = world.execute({
      command: { type: 'start_speech', sequence: 3 },
      actorId: teamActors.aff2,
      now: at(1_080_000),
    });
    assert({
      given: 'the first affirmative calling prep and the second ending it',
      should: 'charge the side the thirty seconds it ran',
      actual: {
        consumed: ended.round?.checkpoint.prep_consumed_ms,
        prep: ended.round?.checkpoint.prep,
      },
      expected: {
        consumed: { affirmative: 30_000, negative: 0 },
        prep: { phase: 'lead', ended_at: at(1_080_000) },
      },
    });
  });

  test('prep running out ends prep at its due instant, then the clock starts one lead later', () => {
    const ready = started();
    ready.tick(at(940_000));
    ready.execute({
      command: { type: 'start_prep', sequence: oneAR },
      actorId: person,
      now: at(945_000),
    });
    const ranOut = at(945_000 + 240_000);
    const expired = ready.tick(at(945_000 + 240_000 + 500));
    assert({
      given: 'a tick half a second after the whole budget was consumed',
      should: 'fold the budget in full and end prep at the due instant',
      actual: {
        consumed: expired.round?.checkpoint.prep_consumed_ms.affirmative,
        prep: expired.round?.checkpoint.prep,
      },
      expected: {
        consumed: 240_000,
        prep: { phase: 'lead', ended_at: ranOut },
      },
    });
    assert({
      given: 'one microphone lead after the due instant',
      should: 'open the segment on the clock',
      actual: ready.tick(at(945_000 + 240_000 + lead)).segmentInserts[0]
        ?.startedAt,
      expected: at(945_000 + 240_000 + lead),
    });
  });

  test('ending prep at the instant it ran out is a race, refused as a conflict (INTX-3)', async () => {
    const world = started();
    world.tick(at(940_000));
    world.execute({
      command: { type: 'start_prep', sequence: oneAR },
      actorId: person,
      now: at(945_000),
    });
    await assertRejects({
      given: 'End prep pressed just after the budget ran out',
      should: 'refuse as a conflict, never an invariant',
      actual: () =>
        world.execute({
          command: { type: 'start_speech', sequence: oneAR },
          actorId: person,
          now: at(945_000 + 240_000 + 100),
        }),
      code: 'CONFLICT',
    });
  });

  test('a side whose last present debater leaves loses its called and running prep (INTX-4)', () => {
    const rules = teamRules({ outcome: { kind: 'ranking', of: 'sides' } });
    const called = teamWorld({ rules });
    called.activate({ at: at(0), now: at(0) });
    called.tick(at(1_000_000));
    called.execute({
      command: { type: 'start_prep', sequence: 3 },
      actorId: teamActors.aff1,
      now: at(1_000_000),
    });
    called.execute({
      command: { type: 'leave' },
      actorId: teamActors.aff1,
      now: at(1_001_000),
    });
    const partnerStays = called.checkpoint().prep;
    const gone = called.execute({
      command: { type: 'leave' },
      actorId: teamActors.aff2,
      now: at(1_002_000),
    });
    assert({
      given:
        'one affirmative leaving, then the other, while their prep is called',
      should: 'keep the call while a partner remains, then drop it',
      actual: [partnerStays, gone.round?.checkpoint.prep],
      expected: [{ phase: 'called', side: 'affirmative' }, { phase: 'idle' }],
    });
  });

  test('no microphone opens during prep, and it opens for the lead after', () => {
    const world = started();
    world.tick(at(940_000));
    world.execute({
      command: { type: 'start_prep', sequence: oneAR },
      actorId: person,
      now: at(945_000),
    });
    const seat = oneOnOneSeats.find((row) => row.actorId === person)!;
    const microphone = (ms: number) =>
      mediaGrants({
        participants: oneOnOneSeats.map((row) => ({
          ...row,
          eligible: true,
          ageBand: 'adult' as const,
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
      command: { type: 'start_speech', sequence: oneAR },
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

  test('a forfeit inside the lead leaves no prep behind', () => {
    const world = started();
    world.tick(at(940_000));
    world.execute({
      command: { type: 'start_prep', sequence: oneAR },
      actorId: person,
      now: at(945_000),
    });
    world.execute({
      command: { type: 'start_speech', sequence: oneAR },
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
      should: 'end the Round with prep idle',
      actual: forfeited.round?.checkpoint.prep,
      expected: { phase: 'idle' },
    });
  });

  test('prep cannot restart inside the lead after it ended', async () => {
    const world = started();
    world.tick(at(940_000));
    world.execute({
      command: { type: 'start_prep', sequence: oneAR },
      actorId: person,
      now: at(945_000),
    });
    world.execute({
      command: { type: 'start_speech', sequence: oneAR },
      actorId: person,
      now: at(1_005_000),
    });
    await assertRejects({
      given: 'start_prep inside the lead after prep ended',
      should: 'refuse, so the microphone already open stays open',
      actual: () =>
        world.execute({
          command: { type: 'start_prep', sequence: oneAR },
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
          command: { type: 'start_prep', sequence: 0 },
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
          command: { type: 'start_prep', sequence: 0 },
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

  test('a press naming a segment that has passed is refused as stale (INTX-7)', async () => {
    const world = started();
    world.tick(at(1_300_000)); // NR live; 2AR is next
    await assertRejects({
      given: 'a call meant for the 1AR arriving during the NR',
      should: 'refuse as stale rather than prep for the 2AR',
      actual: () =>
        world.execute({
          command: { type: 'start_prep', sequence: oneAR },
          actorId: person,
          now: at(1_300_000),
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the same call naming the 2AR',
      should: 'be called',
      actual: world.execute({
        command: { type: 'start_prep', sequence: twoAR },
        actorId: person,
        now: at(1_300_000),
      }).round?.checkpoint.prep,
      expected: { phase: 'called', side: 'affirmative' },
    });
  });

  test('exposes the checkpoint it executes against', () => {
    const world = runtimeWorld();
    assert({
      given: 'a fresh one-on-one world',
      should: 'parse its checkpoint with the runtime schema',
      actual: world.checkpoint(),
      expected: emptyCheckpoint,
    });
  });
});
