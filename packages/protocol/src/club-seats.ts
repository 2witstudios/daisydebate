import { normalizeEmail } from './email';

/**
 * Club seats (ADR 0148): a club's plan pays for `seatCount` Premium seats.
 * A seat is held by one club member; a pending invitation holds a seat until
 * it is accepted, declined, cancelled or expires. These rules are pure and
 * total: the instant is injected, and a refusal leaves the state unchanged.
 */
export const clubSeatBounds = {
  /** The most seats one club plan may carry. */
  maxSeats: 200,
  /** A seat invitation lapses after 14 days. */
  invitationTtlMs: 14 * 24 * 60 * 60 * 1000,
  /** One invitation mails at most this many times, at most once an hour. */
  sendsPerInvitation: 5,
  resendAfterMs: 60 * 60 * 1000,
  /** A club sends at most this many invitation mails a day, plus three per seat. */
  dailyInvitationMails: 20,
} as const;

export type ClubSeat = {
  readonly userId: string;
  readonly assignedAt: string;
};
export type SeatInvitation = {
  readonly id: string;
  /** Normalised; compared case-insensitively. */
  readonly email: string;
  readonly createdAt: string;
  readonly expiresAt: string;
};
/** The pending invitations (live or lapsed) and the held seats of one club. */
export type ClubSeating = {
  readonly seatCount: number;
  readonly seats: readonly ClubSeat[];
  readonly invitations: readonly SeatInvitation[];
};

/** A club member who may receive a seat, with the facts the rules need. */
export type SeatMember = {
  readonly kind: 'member';
  readonly userId: string;
  /** An active member of this club. */
  readonly isMember: boolean;
  /** Holds a seat in another club: one seat per account. */
  readonly seatedElsewhere: boolean;
};
export type SeatInvitee = {
  readonly kind: 'invite';
  readonly invitationId: string;
  readonly email: string;
};

export type ClubSeatingCommand =
  | {
      readonly kind: 'invite';
      readonly invitationId: string;
      readonly email: string;
    }
  | {
      readonly kind: 'accept';
      readonly invitationId: string;
      readonly userId: string;
      readonly seatedElsewhere: boolean;
    }
  | { readonly kind: 'decline' | 'cancel'; readonly invitationId: string }
  | { readonly kind: 'assign'; readonly target: SeatMember }
  | {
      readonly kind: 'move';
      readonly fromUserId: string;
      readonly to: SeatMember | SeatInvitee;
    }
  | { readonly kind: 'remove'; readonly userId: string }
  | {
      readonly kind: 'change-seat-count';
      readonly seatCount: number;
      /** Exactly the seats and invitations to give up when cutting below seats used. */
      readonly release: {
        readonly seats: readonly string[];
        readonly invitations: readonly string[];
      };
    };

export const clubSeatingRefusals = [
  'no-free-seat',
  'already-invited',
  'invitation-not-found',
  'invitation-expired',
  'already-seated',
  'seated-elsewhere',
  'not-a-member',
  'not-seated',
  'seat-count-out-of-range',
  'choose-released-seats',
  'unexpected-release',
  // Decided where the plan and mail are read, not by these pure rules:
  /** The club has no paid plan that grants access now. */
  'no-active-plan',
  /** This invitation was sent within the hour, or its mail is still waiting. */
  'resend-too-soon',
  /** This invitation, or this club today, has sent as many invitations as allowed. */
  'invitation-mail-limit',
] as const;
export type ClubSeatingRefusal = (typeof clubSeatingRefusals)[number];

export type ClubSeatingDecision =
  | { readonly kind: 'changed'; readonly state: ClubSeating }
  | { readonly kind: 'refused'; readonly reason: ClubSeatingRefusal };

const refuse = (reason: ClubSeatingRefusal): ClubSeatingDecision => ({
  kind: 'refused',
  reason,
});
const changed = (state: ClubSeating): ClubSeatingDecision => ({
  kind: 'changed',
  state,
});

const isLive = (invitation: SeatInvitation, now: string) =>
  Date.parse(now) < Date.parse(invitation.expiresAt);

/** Invitations that still hold a seat at this instant. */
export const liveInvitations = (state: ClubSeating, now: string) =>
  state.invitations.filter((invitation) => isLive(invitation, now));

/** Seats held plus live invitations: what the seat count must cover. */
export const seatsUsed = (state: ClubSeating, now: string) =>
  state.seats.length + liveInvitations(state, now).length;

/** The lowest seat count reachable without releasing anyone (never below one). */
export const lowestSeatCount = (state: ClubSeating, now: string) =>
  Math.max(1, seatsUsed(state, now));

const holds = (state: ClubSeating, userId: string) =>
  state.seats.some((seat) => seat.userId === userId);
const hasFreeSeat = (state: ClubSeating, now: string) =>
  seatsUsed(state, now) < state.seatCount;
const withoutInvitation = (state: ClubSeating, id: string): ClubSeating => ({
  ...state,
  invitations: state.invitations.filter((invitation) => invitation.id !== id),
});
const withoutSeat = (state: ClubSeating, userId: string): ClubSeating => ({
  ...state,
  seats: state.seats.filter((seat) => seat.userId !== userId),
});

function assign(
  state: ClubSeating,
  target: SeatMember,
  now: string,
): ClubSeatingDecision {
  if (!target.isMember) return refuse('not-a-member');
  if (holds(state, target.userId)) return refuse('already-seated');
  if (target.seatedElsewhere) return refuse('seated-elsewhere');
  if (!hasFreeSeat(state, now)) return refuse('no-free-seat');
  return changed({
    ...state,
    seats: [...state.seats, { userId: target.userId, assignedAt: now }],
  });
}

function invite(
  state: ClubSeating,
  invitationId: string,
  address: string,
  now: string,
): ClubSeatingDecision {
  const email = normalizeEmail(address);
  if (
    liveInvitations(state, now).some(
      (invitation) => normalizeEmail(invitation.email) === email,
    )
  )
    return refuse('already-invited');
  if (!hasFreeSeat(state, now)) return refuse('no-free-seat');
  const expiresAt = new Date(
    Date.parse(now) + clubSeatBounds.invitationTtlMs,
  ).toISOString();
  return changed({
    ...state,
    invitations: [
      ...state.invitations,
      { id: invitationId, email, createdAt: now, expiresAt },
    ],
  });
}

function accept(
  state: ClubSeating,
  command: Extract<ClubSeatingCommand, { kind: 'accept' }>,
  now: string,
): ClubSeatingDecision {
  const invitation = state.invitations.find(
    (candidate) => candidate.id === command.invitationId,
  );
  if (!invitation) return refuse('invitation-not-found');
  if (!isLive(invitation, now)) return refuse('invitation-expired');
  if (holds(state, command.userId)) return refuse('already-seated');
  if (command.seatedElsewhere) return refuse('seated-elsewhere');
  // The invitation held this seat, so converting it never needs a free one.
  const next = withoutInvitation(state, invitation.id);
  return changed({
    ...next,
    seats: [...next.seats, { userId: command.userId, assignedAt: now }],
  });
}

function move(
  state: ClubSeating,
  command: Extract<ClubSeatingCommand, { kind: 'move' }>,
  now: string,
): ClubSeatingDecision {
  if (!holds(state, command.fromUserId)) return refuse('not-seated');
  const freed = withoutSeat(state, command.fromUserId);
  const to = command.to;
  switch (to.kind) {
    case 'member':
      return to.userId === command.fromUserId
        ? refuse('already-seated')
        : assign(freed, to, now);
    case 'invite':
      return invite(freed, to.invitationId, to.email, now);
  }
}

const distinct = (values: readonly string[]) =>
  new Set(values).size === values.length;

function changeSeatCount(
  state: ClubSeating,
  command: Extract<ClubSeatingCommand, { kind: 'change-seat-count' }>,
  now: string,
): ClubSeatingDecision {
  const { seatCount, release } = command;
  if (
    !Number.isInteger(seatCount) ||
    seatCount < 1 ||
    seatCount > clubSeatBounds.maxSeats
  )
    return refuse('seat-count-out-of-range');
  const used = seatsUsed(state, now);
  const named = release.seats.length + release.invitations.length;
  if (seatCount >= used)
    return named === 0
      ? changed({ ...state, seatCount })
      : refuse('unexpected-release');
  const live = liveInvitations(state, now);
  const valid =
    distinct(release.seats) &&
    distinct(release.invitations) &&
    release.seats.every((userId) => holds(state, userId)) &&
    release.invitations.every((id) => live.some((i) => i.id === id)) &&
    named === used - seatCount;
  if (!valid) return refuse('choose-released-seats');
  return changed({
    seatCount,
    seats: state.seats.filter((seat) => !release.seats.includes(seat.userId)),
    invitations: state.invitations.filter(
      (invitation) => !release.invitations.includes(invitation.id),
    ),
  });
}

/** Decide one seat command against the club's current seating. */
export function decideClubSeating(
  state: ClubSeating,
  command: ClubSeatingCommand,
  now: string,
): ClubSeatingDecision {
  switch (command.kind) {
    case 'invite':
      return invite(state, command.invitationId, command.email, now);
    case 'accept':
      return accept(state, command, now);
    case 'decline':
    case 'cancel':
      return state.invitations.some((i) => i.id === command.invitationId)
        ? changed(withoutInvitation(state, command.invitationId))
        : refuse('invitation-not-found');
    case 'assign':
      return assign(state, command.target, now);
    case 'move':
      return move(state, command, now);
    case 'remove':
      return holds(state, command.userId)
        ? changed(withoutSeat(state, command.userId))
        : refuse('not-seated');
    case 'change-seat-count':
      return changeSeatCount(state, command, now);
  }
}

/**
 * The seats the paid seat count funds: all of them normally; if the count
 * was cut below the seats held outside Daisy, the earliest assigned keep
 * Premium (ties by account id) until the club releases someone.
 */
export function fundedSeats(
  seats: readonly ClubSeat[],
  seatCount: number,
): readonly ClubSeat[] {
  return [...seats]
    .sort(
      (a, b) =>
        Date.parse(a.assignedAt) - Date.parse(b.assignedAt) ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    )
    .slice(0, Math.max(0, seatCount));
}
