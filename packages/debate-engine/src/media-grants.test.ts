import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mediaGrants } from './media-grants';
import {
  practiceRules,
  practiceSeats,
  roundAt,
  runtimeWorld,
} from './runtime.test-support';

setupRitewayBun();
const seats = practiceSeats.map((seat) => ({
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
    rules: practiceRules(),
    position: world.position(now),
    now,
    finalSegmentEndedAt: null,
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
  world.execute({ command: { type: 'start' }, actorId: null, now: roundAt(0) });
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
      rules: practiceRules(),
      position: world.position(roundAt(0)),
      now: roundAt(0),
      finalSegmentEndedAt: null,
    }).subscribe,
    expected: false,
  });
});

test('prep and closed between-segment floor keep cameras without speech rights', () => {
  const world = runtimeWorld();
  world.execute({ command: { type: 'start' }, actorId: null, now: roundAt(0) });
  world.tick(roundAt(10_000));
  world.execute({
    command: { type: 'yield' },
    actorId: seats[0]!.actorId,
    now: roundAt(20_000),
  });
  assert({
    given: 'an early yield before the old scheduled end',
    should: 'close the old speaker microphone',
    actual: grants(world, seats[0]!.id, roundAt(20_000)).publish,
    expected: ['camera'],
  });
  const prep = runtimeWorld();
  prep.execute({ command: { type: 'start' }, actorId: null, now: roundAt(0) });
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

test('ordered accepted floor and free interaction preserve legal custom seats', () => {
  const rules = practiceRules();
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
  world.execute({ command: { type: 'start' }, actorId: null, now: roundAt(0) });
  world.tick(roundAt(10_000));
  const position = {
    ...world.position(roundAt(10_000)),
    openSegment: {
      ...world.position(roundAt(10_000)).openSegment!,
      floorParticipantId: seats[1]!.id,
    },
  };
  const derive = (free: boolean) =>
    participants.map(
      (seat) =>
        mediaGrants({
          participants,
          participantId: seat.id,
          rules: {
            ...interaction,
            interaction: {
              ...rules.interaction,
              crossExMode: free ? 'free' : 'ordered',
            },
          },
          position,
          now: roundAt(10_000),
          finalSegmentEndedAt: null,
        }).publish,
    );
  assert({
    given: 'ordered CX with an accepted opposite floor',
    should: 'open only the floor microphone',
    actual: derive(false),
    expected: [['camera'], ['camera', 'microphone'], [], []],
  });
  assert({
    given: 'free CX with multiple seats including a bot',
    should: 'open all debater microphones and no judge or bot camera',
    actual: derive(true),
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
    awaitingBallot: true,
    nextSegment: null,
  };
  const derive = (now: string, finalSegmentEndedAt: string | null) =>
    mediaGrants({
      participants: seats,
      participantId: seats[0]!.id,
      rules: practiceRules(),
      position,
      now,
      finalSegmentEndedAt,
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
