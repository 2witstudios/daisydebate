import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  eraseSeats,
  executeRoomCommand,
  projectRoom,
  releaseRestrictedMember,
} from './room-assembly';
import type { RoomAssemblyState } from '@daisy/protocol';
import {
  consent,
  edges,
  started,
  state,
} from './room-assembly.test-support';

setupRitewayBun();

test('erasing a seated player leaves the Room as if they had left', () => {
  const room = state();
  const next = eraseSeats(room, 'other');
  assert({
    given: 'a ready Room whose Negative is erased',
    should:
      'remove their seat, return to assembling, bump the version and ask the rest to ready again',
    actual: [
      next.participants.map((p) => [p.actorId, p.consentCommandId]),
      next.status,
      next.version - room.version,
    ],
    expected: [[['host', null]], 'assembling', 1],
  });
});

test('erasing someone without a seat changes only the version', () => {
  const room = started(state());
  assert({
    given: 'a started Room and an actor who never sat in it',
    should: 'keep every seat and the status',
    actual: [
      eraseSeats(room, 'nobody').participants.length,
      eraseSeats(room, 'nobody').status,
    ],
    expected: [2, 'started'],
  });
});

test('a restriction frees the seats and keeps the Room open for the others', () => {
  const room = state();
  const next = releaseRestrictedMember(room, 'other');
  assert({
    given: 'a ready Room whose Negative is restricted',
    should: 'free the seat, keep the host and leave the Room assembling',
    actual: [
      next.participants.map((p) => p.actorId),
      next.hostActorId,
      next.status,
    ],
    expected: [['host'], 'host', 'assembling'],
  });
});

test('a restricted host passes the Room to the first human still seated', () => {
  const next = releaseRestrictedMember(state(), 'host');
  const heir = state().participants.find((p) => p.actorId === 'other')!;
  assert({
    given: 'a ready Room whose host is restricted',
    should: 'free their seat, name the seated human host and stay open',
    actual: [
      next.participants.map((p) => p.actorId),
      next.hostActorId,
      next.hostLabel,
      next.status,
    ],
    expected: [['other'], 'other', heir.label, 'assembling'],
  });
});

test('a restricted host with no human left closes the Room', () => {
  const room = state();
  const onlyHost = {
    ...room,
    participants: room.participants.filter((p) => p.actorId === 'host'),
  };
  const withBot = {
    ...room,
    participants: room.participants.map((p) =>
      p.actorId === 'host' ? p : { ...p, kind: 'bot' as const },
    ),
  };
  assert({
    given: 'a host alone, and a host with only a bot seated',
    should: 'close the Room each time',
    actual: [
      releaseRestrictedMember(onlyHost, 'host').status,
      releaseRestrictedMember(withBot, 'host').status,
    ],
    expected: ['closed', 'closed'],
  });
});

test('the heir is the first eligible debater by side and slot, then a judge', () => {
  const room = state();
  const [hostSeat, other] = room.participants;
  const seat = (
    actorId: string,
    role: 'affirmative' | 'negative' | 'judge',
    slot: number,
    eligible = true,
  ) => ({
    ...other!,
    id: actorId,
    actorId,
    role,
    slot,
    eligible,
    kind: 'human' as const,
  });
  const heirOf = (seats: readonly (typeof room.participants)[number][]) =>
    releaseRestrictedMember(
      { ...room, participants: [hostSeat!, ...seats] },
      'host',
    ).hostActorId;
  assert({
    given: 'a judge listed first, then a negative',
    should: 'pass over the judge',
    actual: heirOf([seat('judge', 'judge', 0), seat('neg', 'negative', 0)]),
    expected: 'neg',
  });
  assert({
    given: 'two seats on a side',
    should: 'take the lower slot',
    actual: heirOf([seat('two', 'negative', 1), seat('one', 'negative', 0)]),
    expected: 'one',
  });
  assert({
    given: 'an ineligible debater and a judge',
    should: 'take the judge',
    actual: heirOf([
      seat('gone', 'negative', 0, false),
      seat('judge', 'judge', 0),
    ]),
    expected: 'judge',
  });
});

test('a host who inherits a Room names no human judge, in the Room or after', () => {
  const room = state();
  const [hostSeat, other] = room.participants;
  const judge = {
    ...other!,
    id: 'judge-seat',
    actorId: 'judge',
    label: 'Hidden judge',
    role: 'judge' as const,
    slot: 0,
    kind: 'human' as const,
  };
  const withJudge = { ...room, participants: [hostSeat!, other!, judge] };
  const now = '2026-11-03T12:00:00.000Z';
  const judgeReady = { ...consent, readyActorIds: ['judge'] };
  const seatFor = (viewer: RoomAssemblyState, actorId: string) =>
    projectRoom(viewer, actorId, judgeReady, now).participants.find(
      (p) => p.role === 'judge',
    );
  const anonymousTo = (viewer: RoomAssemblyState, actorId: string) => {
    const seat = seatFor(viewer, actorId);
    return seat !== undefined && 'anonymous' in seat;
  };
  const inherited = releaseRestrictedMember(withJudge, 'host');
  assert({
    given: 'a seatless original host, before any restriction',
    should: 'name the judge they seated',
    actual: anonymousTo(
      { ...withJudge, participants: [other!, judge] },
      'host',
    ),
    expected: false,
  });
  assert({
    given: 'an original host who holds a debating seat',
    should: 'see only that the judge seat is filled (WATCH-6)',
    actual: anonymousTo(withJudge, 'host'),
    expected: true,
  });
  assert({
    given: 'a debater who inherits the Room',
    should: 'become host and still see only that the seat is filled',
    actual: [
      inherited.hostActorId,
      inherited.hostInherited,
      seatFor(inherited, 'other'),
    ],
    expected: [
      'other',
      true,
      {
        role: 'judge',
        kind: 'human',
        slot: 0,
        anonymous: true,
        needsReady: true,
        ready: 'ready',
        eligible: judge.eligible,
      },
    ],
  });
  assert({
    given: 'the readiness list an inherited host reads',
    should: 'not name a ready judge',
    actual: projectRoom(inherited, 'other', judgeReady, now).readiness
      .readyActorIds,
    expected: [],
  });
  assert({
    given: 'a judge who claims a seat after the hand-off',
    should: 'stay hidden from the inherited host too',
    actual: anonymousTo(
      {
        ...inherited,
        participants: [
          ...inherited.participants,
          { ...judge, id: 'late-seat', actorId: 'late', slot: 1 },
        ],
      },
      'other',
    ),
    expected: true,
  });
  assert({
    given: 'the judge reading their own seat under the inherited host',
    should: 'name them to themselves',
    actual: anonymousTo(inherited, 'judge'),
    expected: false,
  });
});

describe('assign-seat from a host who inherited the Room', () => {
  const room = state();
  const [hostSeat, other] = room.participants;
  const judge = {
    ...other!,
    id: 'judge-seat',
    actorId: 'judge',
    label: 'Hidden judge',
    role: 'judge' as const,
    slot: 0,
    kind: 'human' as const,
  };
  const debater = {
    ...other!,
    id: 'debater-seat',
    actorId: 'debater',
    label: 'Second debater',
    role: 'negative' as const,
    slot: 1,
    kind: 'human' as const,
  };
  const inherited = releaseRestrictedMember(
    {
      ...room,
      rules: { ...room.rules, seats: { ...room.rules.seats, judge: 2 } },
      participants: [hostSeat!, other!, judge, debater],
    },
    'host',
  );
  const assign = (
    from: RoomAssemblyState,
    target: { readonly actorId: string; readonly label: string },
    role: 'affirmative' | 'negative' | 'judge',
    slot: number,
  ) =>
    executeRoomCommand(
      from,
      'other',
      {
        commandId: 'assign',
        expectedVersion: from.version,
        type: 'assign-seat',
        actorId: target.actorId,
        role,
        slot,
      },
      consent,
      {
        ...edges,
        target: {
          ...other!,
          ...target,
          kind: 'human',
          eligible: true,
          seatRole: null,
        },
      },
    );
  const refusal = (outcome: ReturnType<typeof assign>) =>
    outcome.ok ? 'accepted' : outcome.refusal;
  const stranger = { actorId: 'stranger', label: 'Stranger' };
  const suspect = { actorId: judge.actorId, label: judge.label };

  test('a hidden judge answers as a member who is not seated', () => {
    assert({
      given:
        'the heir sending the hidden judge and a stranger to the judge seat',
      should: 'refuse both alike, so the answer tests nothing',
      actual: [
        refusal(assign(inherited, suspect, 'judge', 1)),
        refusal(assign(inherited, stranger, 'judge', 1)),
      ],
      expected: ['actor-ineligible', 'actor-ineligible'],
    });
    assert({
      given:
        'the heir sending the hidden judge to a debater seat they can read',
      should: 'refuse it as they refuse a stranger',
      actual: [
        refusal(assign(inherited, suspect, 'affirmative', 1)),
        refusal(assign(inherited, stranger, 'affirmative', 1)),
      ],
      expected: ['actor-ineligible', 'actor-ineligible'],
    });
  });

  test('a debater who hosts tests nothing either', () => {
    const hosting: RoomAssemblyState = {
      ...room,
      hostActorId: 'other',
      hostLabel: other!.label,
      rules: { ...room.rules, seats: { ...room.rules.seats, judge: 2 } },
      participants: [other!, judge, debater],
    };
    assert({
      given:
        'a host holding a debating seat sending the hidden judge and a stranger to a seat',
      should: 'refuse both alike, so the answer names no judge (WATCH-6)',
      actual: [
        refusal(assign(hosting, suspect, 'judge', 1)),
        refusal(assign(hosting, stranger, 'judge', 1)),
        refusal(assign(hosting, suspect, 'affirmative', 1)),
        refusal(assign(hosting, stranger, 'affirmative', 1)),
      ],
      expected: Array.from({ length: 4 }, () => 'actor-ineligible'),
    });
  });

  test('a judge the heir assigns shows as filled', () => {
    const outcome = assign(
      inherited,
      { actorId: debater.actorId, label: debater.label },
      'judge',
      1,
    );
    if (!outcome.ok) throw Error(`Refused: ${outcome.refusal}`);
    const seats = projectRoom(
      outcome.mutation.state,
      'other',
      consent,
      edges.now,
    ).participants.filter((p) => p.role === 'judge');
    assert({
      given: 'a seated debater the heir moves to a judge seat',
      should: 'accept it and show every judge seat only as filled',
      actual: seats.map((seat) => 'anonymous' in seat),
      expected: [true, true],
    });
  });

  test('a seatless host who seated their judges still assigns them', () => {
    const own = {
      ...inherited,
      hostInherited: false,
      participants: inherited.participants.filter(
        (p) => p.actorId !== inherited.hostActorId,
      ),
    };
    assert({
      given: 'the same move from a seatless host who did not inherit',
      should: 'accept it',
      actual: refusal(assign(own, suspect, 'judge', 1)),
      expected: 'accepted',
    });
  });
});
