import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clubSeatBounds,
  decideClubSeating,
  fundedSeats,
  liveInvitations,
  lowestSeatCount,
  seatsUsed,
  type ClubSeating,
  type ClubSeatingCommand,
} from './club-seats';

setupRitewayBun();

const now = '2026-11-18T12:00:00.000Z';
const later = '2026-12-10T12:00:00.000Z';
const user = (n: number) => `u${String(n).padStart(23, '0')}`;
const invite = (n: number) => `i${String(n).padStart(23, '0')}`;
const seat = (n: number, assignedAt = '2026-11-01T00:00:00.000Z') => ({
  userId: user(n),
  assignedAt,
});
const invitation = (n: number, expiresAt = '2026-11-30T00:00:00.000Z') => ({
  id: invite(n),
  email: `p${n}@example.org`,
  createdAt: '2026-11-16T00:00:00.000Z',
  expiresAt,
});
const seating = (
  seatCount: number,
  seats: ClubSeating['seats'],
  invitations: ClubSeating['invitations'] = [],
): ClubSeating => ({ seatCount, seats, invitations });
const decide = (state: ClubSeating, command: ClubSeatingCommand) =>
  decideClubSeating(state, command, now);
const reason = (result: ReturnType<typeof decideClubSeating>) =>
  result.kind === 'refused' ? result.reason : 'changed';
const member = (n: number, seatedElsewhere = false) => ({
  kind: 'member' as const,
  userId: user(n),
  isMember: true,
  seatedElsewhere,
});

test('seats used counts held seats and live invitations only', () => {
  const state = seating(
    5,
    [seat(1), seat(2)],
    [invitation(1), invitation(2, '2026-11-17T00:00:00.000Z')],
  );
  assert({
    given: 'two seats, one live and one expired invitation',
    should:
      'count three used, one live invitation, and a lowest count of three',
    actual: [
      seatsUsed(state, now),
      liveInvitations(state, now).map((i) => i.id),
      lowestSeatCount(state, now),
    ],
    expected: [3, [invite(1)], 3],
  });
  assert({
    given: 'a club with nothing held',
    should: 'never let the lowest seat count fall below one',
    actual: lowestSeatCount(seating(3, []), now),
    expected: 1,
  });
});

test('inviting holds a free seat and refuses when the seats are full', () => {
  const full = seating(2, [seat(1)], [invitation(1)]);
  const roomy = seating(3, [seat(1)], [invitation(1)]);
  const command = {
    kind: 'invite',
    invitationId: invite(9),
    email: 'new@example.org',
  } as const;
  const changed = decide(roomy, command);
  assert({
    given: 'every seat held or invited',
    should: 'refuse with no free seat',
    actual: reason(decide(full, command)),
    expected: 'no-free-seat',
  });
  assert({
    given: 'a free seat',
    should: `add a pending invitation that expires after ${clubSeatBounds.invitationTtlMs} ms`,
    actual:
      changed.kind === 'changed'
        ? changed.state.invitations.find((i) => i.id === invite(9))
        : null,
    expected: {
      id: invite(9),
      email: 'new@example.org',
      createdAt: now,
      expiresAt: new Date(
        Date.parse(now) + clubSeatBounds.invitationTtlMs,
      ).toISOString(),
    },
  });
  assert({
    given: 'an address that already has a live invitation (any case)',
    should: 'refuse it as already invited',
    actual: reason(decide(roomy, { ...command, email: 'P1@Example.org' })),
    expected: 'already-invited',
  });
  assert({
    given: 'an expired invitation filling the last seat',
    should: 'treat that seat as free',
    actual: reason(
      decide(
        seating(2, [seat(1)], [invitation(1, '2026-11-01T00:00:00.000Z')]),
        command,
      ),
    ),
    expected: 'changed',
  });
});

test('accepting turns a live invitation into a seat', () => {
  const state = seating(2, [seat(1)], [invitation(2)]);
  const accept = {
    kind: 'accept',
    invitationId: invite(2),
    userId: user(2),
    seatedElsewhere: false,
  } as const;
  const changed = decide(state, accept);
  assert({
    given: 'a live invitation',
    should: 'seat the account from now and drop the invitation',
    actual: changed.kind === 'changed' ? changed.state : null,
    expected: seating(2, [seat(1), { userId: user(2), assignedAt: now }], []),
  });
  assert({
    given: 'an expired, unknown, already-seated or elsewhere-seated acceptance',
    should: 'refuse each with its reason',
    actual: [
      decide(
        seating(2, [seat(1)], [invitation(2, '2026-11-01T00:00:00.000Z')]),
        accept,
      ),
      decide(state, { ...accept, invitationId: invite(7) }),
      decide(state, { ...accept, userId: user(1) }),
      decide(state, { ...accept, seatedElsewhere: true }),
    ].map(reason),
    expected: [
      'invitation-expired',
      'invitation-not-found',
      'already-seated',
      'seated-elsewhere',
    ],
  });
});

test('declining or cancelling an invitation frees its seat', () => {
  const state = seating(2, [seat(1)], [invitation(2)]);
  for (const kind of ['decline', 'cancel'] as const) {
    const result = decide(state, { kind, invitationId: invite(2) });
    assert({
      given: `a ${kind} of a pending invitation`,
      should: 'remove only that invitation',
      actual: result.kind === 'changed' ? result.state : null,
      expected: seating(2, [seat(1)], []),
    });
  }
  assert({
    given: 'an unknown invitation',
    should: 'refuse it',
    actual: reason(decide(state, { kind: 'cancel', invitationId: invite(5) })),
    expected: 'invitation-not-found',
  });
});

test('assigning seats a club member into a free seat', () => {
  const state = seating(2, [seat(1)]);
  assert({
    given: 'a member without a seat and a free seat',
    should: 'seat them from now',
    actual: decide(state, { kind: 'assign', target: member(2) }),
    expected: {
      kind: 'changed',
      state: seating(2, [seat(1), { userId: user(2), assignedAt: now }]),
    },
  });
  assert({
    given: 'no free seat, a non-member, a holder, or someone seated elsewhere',
    should: 'refuse each with its reason',
    actual: [
      decide(seating(1, [seat(1)]), { kind: 'assign', target: member(2) }),
      decide(state, {
        kind: 'assign',
        target: { ...member(2), isMember: false },
      }),
      decide(state, { kind: 'assign', target: member(1) }),
      decide(state, { kind: 'assign', target: member(2, true) }),
    ].map(reason),
    expected: [
      'no-free-seat',
      'not-a-member',
      'already-seated',
      'seated-elsewhere',
    ],
  });
});

test('moving a seat frees it and gives it to the target in one step', () => {
  const full = seating(2, [seat(1), seat(2)]);
  assert({
    given: 'a full club moving a seat to a member without one',
    should: 'unseat the holder and seat the target from now',
    actual: decide(full, { kind: 'move', fromUserId: user(1), to: member(3) }),
    expected: {
      kind: 'changed',
      state: seating(2, [seat(2), { userId: user(3), assignedAt: now }]),
    },
  });
  const toNew = decide(full, {
    kind: 'move',
    fromUserId: user(1),
    to: { kind: 'invite', invitationId: invite(4), email: 'new@example.org' },
  });
  assert({
    given: 'a full club moving a seat to someone new by email',
    should: 'unseat the holder and hold the seat for the new invitation',
    actual:
      toNew.kind === 'changed'
        ? [toNew.state.seats, toNew.state.invitations.map((i) => i.id)]
        : null,
    expected: [[seat(2)], [invite(4)]],
  });
  assert({
    given: 'a move from someone without a seat, or to the same holder',
    should: 'refuse it',
    actual: [
      decide(full, { kind: 'move', fromUserId: user(5), to: member(3) }),
      decide(full, { kind: 'move', fromUserId: user(1), to: member(2) }),
    ].map(reason),
    expected: ['not-seated', 'already-seated'],
  });
});

test('removing a seat keeps the count and frees the seat', () => {
  assert({
    given: 'a seat holder',
    should: 'remove only their seat',
    actual: decide(seating(3, [seat(1), seat(2)]), {
      kind: 'remove',
      userId: user(1),
    }),
    expected: { kind: 'changed', state: seating(3, [seat(2)]) },
  });
  assert({
    given: 'someone without a seat',
    should: 'refuse it',
    actual: reason(
      decide(seating(3, [seat(1)]), { kind: 'remove', userId: user(9) }),
    ),
    expected: 'not-seated',
  });
});

test('the seat count never drops below seats used without naming who loses a seat', () => {
  const state = seating(4, [seat(1), seat(2), seat(3)], [invitation(1)]);
  const change = (
    seatCount: number,
    release = { seats: [] as string[], invitations: [] as string[] },
  ) => decide(state, { kind: 'change-seat-count', seatCount, release });
  assert({
    given: 'a raise, or a cut down to exactly seats used',
    should: 'change the count and keep everyone',
    actual: [change(6), change(4)].map((r) =>
      r.kind === 'changed' ? r.state.seatCount : r.reason,
    ),
    expected: [6, 4],
  });
  assert({
    given: 'a cut below seats used naming nobody, too few, or too many',
    should: 'refuse until exactly the excess is chosen',
    actual: [
      change(2),
      change(2, { seats: [user(1)], invitations: [] }),
      change(3, { seats: [user(1)], invitations: [invite(1)] }),
      change(5, { seats: [user(1)], invitations: [] }),
    ].map(reason),
    expected: [
      'choose-released-seats',
      'choose-released-seats',
      'choose-released-seats',
      'unexpected-release',
    ],
  });
  assert({
    given: 'a cut to two naming one seat and the invitation',
    should: 'release exactly those',
    actual: change(2, { seats: [user(1)], invitations: [invite(1)] }),
    expected: { kind: 'changed', state: seating(2, [seat(2), seat(3)], []) },
  });
  assert({
    given: 'names that are not held, or repeated',
    should: 'refuse them',
    actual: [
      change(3, { seats: [user(9)], invitations: [] }),
      change(2, { seats: [user(1), user(1)], invitations: [] }),
    ].map(reason),
    expected: ['choose-released-seats', 'choose-released-seats'],
  });
  assert({
    given: `a count outside 1..${clubSeatBounds.maxSeats} or not a whole number`,
    should: 'refuse it as out of range',
    actual: [0, clubSeatBounds.maxSeats + 1, 2.5].map((n) => reason(change(n))),
    expected: [
      'seat-count-out-of-range',
      'seat-count-out-of-range',
      'seat-count-out-of-range',
    ],
  });
});

test('a refused command never changes the state', () => {
  const state = seating(1, [seat(1)]);
  const before = structuredClone(state);
  decide(state, { kind: 'assign', target: member(2) });
  decide(state, { kind: 'remove', userId: user(4) });
  assert({
    given: 'refused commands',
    should: 'leave the input untouched',
    actual: state,
    expected: before,
  });
});

test('funded seats follow assignment order up to the paid seat count', () => {
  const seats = [
    seat(3, '2026-11-03T00:00:00.000Z'),
    seat(1, '2026-11-01T00:00:00.000Z'),
    seat(2, '2026-11-01T00:00:00.000Z'),
  ];
  assert({
    given: 'three seats held and a paid count of two (cut outside Daisy)',
    should: 'fund the two earliest, ties broken by account id',
    actual: fundedSeats(seats, 2).map((s) => s.userId),
    expected: [user(1), user(2)],
  });
  assert({
    given: 'a paid count at or above seats held',
    should: 'fund everyone',
    actual: fundedSeats(seats, 5).length,
    expected: 3,
  });
  assert({
    given: 'an instant past an invitation expiry',
    should: 'no longer count the invitation',
    actual: seatsUsed(seating(2, [], [invitation(1)]), later),
    expected: 0,
  });
});
