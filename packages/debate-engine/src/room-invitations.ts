import {
  ROOM_INVITATION_TTL_MS,
  type InvitationDecision,
  type InvitationEndDecision,
  type InviteeFacts,
  type PendingRoomInvitation,
  type RoomAssemblyState,
  type RoomInvitationRefusal,
  type RoomSeatKind,
} from '@daisy/protocol';
import { seatKindOf } from '@daisy/protocol';
import { seatsHeldFrom } from './room-edit-transitions';

const open = (room: Pick<RoomAssemblyState, 'status'>) =>
  room.status === 'assembling' || room.status === 'ready';

const live = (invitation: PendingRoomInvitation, now: string) =>
  Date.parse(invitation.expiresAt) > Date.parse(now);

/**
 * Whether the host may invite this member to this seat kind now (ADR 0124).
 * Only the host of an open Room invites; the member must exist, be eligible,
 * not be blocked either way, not be the host, and not already sit in the
 * Room. One pending invitation per member: the same one again is a repeat,
 * and a member a challenge already holds a seat for here is not invited
 * over it (one hold per member per Room).
 * There must be a free seat of the kind that no other hold already keeps.
 */
export function decideRoomInvitation(input: {
  readonly room: Pick<
    RoomAssemblyState,
    'status' | 'hostActorId' | 'participants' | 'seatHolds' | 'rules'
  >;
  readonly callerActorId: string;
  readonly invitee: InviteeFacts;
  readonly seat: RoomSeatKind;
  readonly pending: readonly PendingRoomInvitation[];
  readonly now: string;
}): InvitationDecision {
  const { room, invitee, seat, now } = input;
  const refuse = (refusal: RoomInvitationRefusal): InvitationDecision => ({
    ok: false,
    refusal,
  });
  if (input.callerActorId !== room.hostActorId) return refuse('not-host');
  if (!open(room)) return refuse('room-not-assembling');
  if (!invitee) return refuse('member-unknown');
  if (
    !invitee.eligible ||
    invitee.blocked ||
    invitee.actorId === room.hostActorId
  )
    return refuse('member-unavailable');
  if (room.participants.some((p) => p.actorId === invitee.actorId))
    return refuse('already-seated');
  const existing = input.pending.find(
    (invitation) =>
      invitation.inviteeActorId === invitee.actorId && live(invitation, now),
  );
  if (existing)
    return existing.seat === seat
      ? { ok: true, kind: 'repeat', invitationId: existing.id }
      : refuse('already-invited');
  if (
    room.seatHolds.some(
      (hold) =>
        hold.actorId === invitee.actorId &&
        Date.parse(hold.until) > Date.parse(now),
    )
  )
    return refuse('already-invited');
  const seats =
    seat === 'judge'
      ? room.rules.seats.judge
      : room.rules.seats.affirmative + room.rules.seats.negative;
  const taken = room.participants.filter(
    (p) => seatKindOf(p.role) === seat,
  ).length;
  if (seats - taken <= seatsHeldFrom(room, invitee.actorId, seat, now))
    return refuse('no-free-seat');
  return {
    ok: true,
    kind: 'invite',
    inviteeActorId: invitee.actorId,
    seat,
    expiresAt: new Date(Date.parse(now) + ROOM_INVITATION_TTL_MS).toISOString(),
  };
}

/**
 * Who may end a pending invitation, and how: the invitee declines, the host
 * withdraws. Anyone else, or an invitation already ended, changes nothing.
 */
export function decideInvitationEnd(input: {
  readonly invitation: PendingRoomInvitation | null;
  readonly hostActorId: string;
  readonly callerActorId: string;
  readonly end: 'decline' | 'withdraw';
  readonly now: string;
}): InvitationEndDecision {
  const { invitation } = input;
  if (!invitation || !live(invitation, input.now))
    return { ok: false, refusal: 'invitation-ended' };
  if (input.end === 'decline')
    return input.callerActorId === invitation.inviteeActorId
      ? { ok: true, state: 'declined' }
      : { ok: false, refusal: 'invitation-ended' };
  return input.callerActorId === input.hostActorId
    ? { ok: true, state: 'withdrawn' }
    : { ok: false, refusal: 'not-host' };
}
