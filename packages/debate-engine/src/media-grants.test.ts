import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mediaGrants } from './media-grants';
import {
  oneOnOneRules,
  oneOnOneSeats,
  roundAt,
  runtimeWorld,
} from './runtime.test-support';

setupRitewayBun();
const seats = oneOnOneSeats.map((seat) => ({
  ...seat,
  kind: 'human' as const,
  eligible: true,
}));
const grants = (
  world = runtimeWorld(),
  participantId = seats[0]!.id,
  now = roundAt(0),
) =>
  mediaGrants({
    participants: seats,
    participantId,
    rules: oneOnOneRules(),
    position: world.position(now),
    now,
    finalSegmentEndedAt: null,
    inPreRoundPrep: false,
  });

test('before the first segment grants conversation but hides judges', () => {
  assert({
    given: 'an eligible human before the first segment',
    should: 'allow conversation camera and microphone',
    actual: grants(),
    expected: {
      publish: ['camera', 'microphone'],
      subscribe: true,
      hidden: false,
      capture: false,
    },
  });
  assert({
    given: 'a judge before the first segment',
    should: 'subscribe hidden without publishing',
    actual: grants(runtimeWorld(), seats[2]!.id),
    expected: { publish: [], subscribe: true, hidden: true, capture: false },
  });
});

test('actual speech opening closes the opponent microphone', () => {
  const world = runtimeWorld();
  world.activate({ at: roundAt(0), now: roundAt(0) });
  world.tick(roundAt(10_000));
  assert({
    given: 'the actual first speech',
    should: 'allow its scheduled seat to speak',
    actual: grants(world, seats[0]!.id, roundAt(10_000)).publish,
    expected: ['camera', 'microphone'],
  });
  assert({
    given: 'the opposite seat during speech',
    should: 'retain only camera',
    actual: grants(world, seats[1]!.id, roundAt(10_000)).publish,
    expected: ['camera'],
  });
});

test('terminal and ineligible participants have no grants', () => {
  assert({
    given: 'completed Round',
    should: 'deny all media',
    actual: grants(runtimeWorld({ status: 'completed' })),
    expected: { publish: [], subscribe: false, hidden: false, capture: false },
  });
  const world = runtimeWorld();
  assert({
    given: 'fresh revoked eligibility',
    should: 'deny all media',
    actual: mediaGrants({
      participants: seats.map((seat) => ({ ...seat, eligible: false })),
      participantId: seats[0]!.id,
      rules: oneOnOneRules(),
      position: world.position(roundAt(0)),
      now: roundAt(0),
      finalSegmentEndedAt: null,
      inPreRoundPrep: false,
    }).subscribe,
    expected: false,
  });
  assert({
    given: 'a judge whose canonical eligibility was revoked',
    should: 'deny all media while staying hidden from debaters',
    actual: mediaGrants({
      participants: seats.map((seat) => ({ ...seat, eligible: false })),
      participantId: seats[2]!.id,
      rules: oneOnOneRules(),
      position: world.position(roundAt(0)),
      now: roundAt(0),
      finalSegmentEndedAt: null,
      inPreRoundPrep: false,
    }),
    expected: { publish: [], subscribe: false, hidden: true, capture: false },
  });
});

test('prep and closed between-segment floor keep cameras without speech rights', () => {
  const world = runtimeWorld();
  world.activate({ at: roundAt(0), now: roundAt(0) });
  world.tick(roundAt(10_000));
  world.execute({
    command: { type: 'yield' },
    actorId: seats[0]!.actorId,
    now: roundAt(20_000),
  });
  assert({
    given: 'an early yield, in the countdown to the other side speaking',
    should:
      'close the old speaker and keep the next closed: nobody hears them before the clock',
    actual: [
      grants(world, seats[0]!.id, roundAt(20_000)).publish,
      grants(world, seats[1]!.id, roundAt(20_000)).publish,
    ],
    expected: [['camera'], ['camera']],
  });
  const prep = runtimeWorld();
  prep.activate({ at: roundAt(0), now: roundAt(0) });
  prep.execute({
    command: { type: 'start_prep' },
    actorId: seats[0]!.actorId,
    now: roundAt(0),
  });
  assert({
    given: 'actual prep',
    should: 'keep every microphone closed',
    actual: seats
      .slice(0, 2)
      .map((seat) => grants(prep, seat.id, roundAt(1)).publish),
    expected: [['camera'], ['camera']],
  });
});

test('cross-examination opens every debater microphone across legal custom seats', () => {
  const rules = oneOnOneRules();
  const interaction = {
    ...rules,
    seats: { ...rules.seats, negative: 2 },
    segments: [{ ...rules.segments[0]!, type: 'cross_ex' as const }],
  };
  const participants = [
    ...seats,
    {
      ...seats[1]!,
      id: 'extra-seat',
      actorId: 'extra-actor',
      slot: 1,
      kind: 'bot' as const,
    },
  ];
  const world = runtimeWorld({ rules: interaction, participants });
  world.activate({ at: roundAt(0), now: roundAt(0) });
  world.tick(roundAt(10_000));
  const position = world.position(roundAt(10_000));
  assert({
    given: 'cross-examination with multiple seats including a bot',
    should: 'open all debater microphones and no judge or bot camera',
    actual: participants.map(
      (seat) =>
        mediaGrants({
          participants,
          participantId: seat.id,
          rules: interaction,
          position,
          now: roundAt(10_000),
          finalSegmentEndedAt: null,
          inPreRoundPrep: false,
        }).publish,
    ),
    expected: [
      ['camera', 'microphone'],
      ['camera', 'microphone'],
      [],
      ['microphone'],
    ],
  });
});

test('judging conversation uses actual final end and never the initial timetable', () => {
  const world = runtimeWorld();
  const position = {
    ...world.position(roundAt(0)),
    status: 'active' as const,
    stage: 'awaiting_ballot' as const,
    nextSegment: null,
  };
  const derive = (now: string, finalSegmentEndedAt: string | null) =>
    mediaGrants({
      participants: seats,
      participantId: seats[0]!.id,
      rules: oneOnOneRules(),
      position,
      now,
      finalSegmentEndedAt,
      inPreRoundPrep: false,
    });
  assert({
    given: 'final actual close and 29 minutes 59 seconds',
    should: 'allow conversation',
    actual: derive(roundAt(1_799_999), roundAt(0)).publish,
    expected: ['camera', 'microphone'],
  });
  assert({
    given: 'the judging-window boundary',
    should: 'close all media',
    actual: derive(roundAt(1_800_000), roundAt(0)).subscribe,
    expected: false,
  });
  assert({
    given: 'missing final actual anchor',
    should: 'refuse rather than guess a timetable',
    actual: derive(roundAt(100), null).subscribe,
    expected: false,
  });
});

test('unchanged grants never dispatch redundant vendor updates', async () => {
  const { changedMediaGrants } = await import('./media-grants');
  const current = [{ identity: 'opaque-seat', grants: grants() }];
  assert({
    given: 'the same source set in reverse order',
    should: 'produce no permission updates',
    actual: changedMediaGrants(current, [
      {
        identity: 'opaque-seat',
        grants: { ...grants(), publish: ['microphone', 'camera'] },
      },
    ]),
    expected: [],
  });
  assert({
    given: 'one closed microphone',
    should: 'return only that changed seat',
    actual: changedMediaGrants(current, [
      { identity: 'opaque-seat', grants: { ...grants(), publish: ['camera'] } },
    ]).map((entry) => entry.identity),
    expected: ['opaque-seat'],
  });
});

test('competitive bot rights remain publish-only through reconciliation', () => {
  const botSeats = seats.map((seat, index) => ({
    ...seat,
    kind: index === 0 ? ('bot' as const) : seat.kind,
  }));
  assert({
    given: 'an eligible competitive bot seat before the first segment',
    should:
      'allow at most conversation microphone without camera, subscription or capture',
    actual: mediaGrants({
      participants: botSeats,
      participantId: botSeats[0]!.id,
      rules: oneOnOneRules(),
      position: runtimeWorld().position(roundAt(0)),
      now: roundAt(0),
      finalSegmentEndedAt: null,
      inPreRoundPrep: false,
    }),
    expected: {
      publish: ['microphone'],
      subscribe: false,
      hidden: false,
      capture: false,
    },
  });
});

test('conversation microphones wait for the audience observer to be revoked', () => {
  const world = runtimeWorld();
  const position = {
    ...world.position(roundAt(0)),
    status: 'active' as const,
    stage: 'awaiting_ballot' as const,
    nextSegment: null,
  };
  const derive = (conversationHeld: boolean | undefined, now = roundAt(1000)) =>
    mediaGrants({
      participants: seats,
      participantId: seats[0]!.id,
      rules: oneOnOneRules(),
      position,
      now,
      finalSegmentEndedAt: roundAt(0),
      inPreRoundPrep: false,
      ...(conversationHeld === undefined ? {} : { conversationHeld }),
    }).publish;
  assert({
    given:
      'the final speech just ended early and the observer is still subscribed',
    should:
      'hold the microphone and leave the camera, so nothing private reaches the audience',
    actual: derive(true),
    expected: ['camera'],
  });
  assert({
    given: 'the observer revoked, and a Round with no Broadcast',
    should: 'open conversation as before',
    actual: [derive(false), derive(undefined)],
    expected: [
      ['camera', 'microphone'],
      ['camera', 'microphone'],
    ],
  });
});

describe('pre-round prep', () => {
  const openingGrants = (inPreRoundPrep: boolean) =>
    mediaGrants({
      participants: seats,
      participantId: seats[0]!.id,
      rules: oneOnOneRules(),
      position: runtimeWorld().position(roundAt(0)),
      now: roundAt(0),
      finalSegmentEndedAt: null,
      inPreRoundPrep,
    }).publish;
  test('every mic and camera closes, and reopens outside prep', () => {
    assert({
      given: 'an opening Round in pre-round prep, then outside it',
      should: 'publish nothing in prep and the usual pre-speech media outside',
      actual: [openingGrants(true), openingGrants(false)],
      expected: [[], ['camera', 'microphone']],
    });
  });
});

describe('a Broadcast observer holds cameras', () => {
  const heldGrants = (
    world: ReturnType<typeof runtimeWorld>,
    now: string,
    held: { conversationHeld?: boolean; cameraHeld?: boolean },
  ) =>
    mediaGrants({
      participants: seats,
      participantId: seats[0]!.id,
      rules: oneOnOneRules(),
      position: world.position(now),
      now,
      finalSegmentEndedAt: now,
      inPreRoundPrep: false,
      ...held,
    }).publish;
  const both = { conversationHeld: true, cameraHeld: true };
  test('a public speech keeps its camera while the observer watches', () => {
    const world = runtimeWorld();
    world.activate({ at: roundAt(0), now: roundAt(0) });
    world.tick(roundAt(10_000));
    assert({
      given: 'a speech with a Broadcast observer subscribed',
      should: 'publish camera and microphone: this is what it is there to see',
      actual: heldGrants(world, roundAt(10_000), both),
      expected: ['camera', 'microphone'],
    });
  });
  test('prep closes cameras only while held, then reopens them', () => {
    const world = runtimeWorld();
    world.activate({ at: roundAt(0), now: roundAt(0) });
    world.execute({
      command: { type: 'start_prep' },
      actorId: seats[0]!.actorId,
      now: roundAt(0),
    });
    assert({
      given: 'prep with the Broadcast observer subscribed, then revoked',
      should: 'publish nothing, then the camera again',
      actual: [
        heldGrants(world, roundAt(1), both),
        heldGrants(world, roundAt(1), { conversationHeld: false }),
      ],
      expected: [[], ['camera']],
    });
  });
  test('a Recording’s own observer holds conversation, not cameras', () => {
    assert({
      given: 'a private opening held by an own-capture observer alone',
      should: 'leave the camera and hold the microphone',
      actual: heldGrants(runtimeWorld(), roundAt(0), {
        conversationHeld: true,
      }),
      expected: ['camera'],
    });
  });
});
