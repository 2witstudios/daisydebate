import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  eraseSeats,
  projectRoom,
  releaseRestrictedMember,
} from './room-assembly';
import type { RoomAssemblyState } from '@daisy/protocol';
import { consent, state } from './room-assembly.test-support';

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
  const room = { ...state(), status: 'started' as const };
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
    given: 'the original host, before any restriction',
    should: 'name the judge they seated',
    actual: anonymousTo(withJudge, 'host'),
    expected: false,
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
