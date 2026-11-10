import { z } from 'zod';
import { idSchema } from './primitives';
import {
  roomSeatKinds,
  type RoomAssemblyState,
  type RoomSeatKind,
} from './room-contract';
import { usernameSchema as username } from './username';


/**
 * A debater invitation is for either side, as a challenge's hold is; the
 * host still arranges sides. A judge invitation holds a judge seat.
 */
export const roomInvitationStates = [
  'pending',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
] as const;
export type RoomInvitationState = (typeof roomInvitationStates)[number];

/** How long an unanswered invitation holds its seat. */
export const ROOM_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

export const roomInvitationCommandSchemas = {
  /** The host invites one member by username. */
  invite: z.strictObject({
    version: z.literal(1),
    commandId: idSchema,
    username,
    seat: z.enum(roomSeatKinds),
  }),
  /** The host takes back a pending invitation. */
  withdraw: z.strictObject({ version: z.literal(1), invitationId: idSchema }),
  /** The invitee says no. */
  decline: z.strictObject({ version: z.literal(1), invitationId: idSchema }),
} as const;

/** Why an invitation command changed nothing. */
export const roomInvitationRefusals = [
  'not-host',
  'room-not-assembling',
  'member-unknown',
  'member-unavailable',
  'already-seated',
  'already-invited',
  'no-free-seat',
  'invitation-ended',
] as const;
export type RoomInvitationRefusal = (typeof roomInvitationRefusals)[number];

/** One pending invitation as its Room's host and its invitee read it. */
export type RoomInvitationView = {
  readonly id: string;
  readonly seat: RoomSeatKind;
  readonly invitee: string;
  readonly inviter: string;
  readonly expiresAt: string;
};

/** A pending invitation as the Room holds it. */
export type PendingRoomInvitation = {
  readonly id: string;
  readonly inviteeActorId: string;
  readonly inviterActorId: string;
  readonly seat: RoomSeatKind;
  readonly expiresAt: string;
};

/** The member a host names, as the store found them; null when nobody has that name. */
export type InviteeFacts = {
  readonly actorId: string;
  /** An admitted participant (ADR 0075) with a username. */
  readonly eligible: boolean;
  /** A block stands between host and invitee, either way. */
  readonly blocked: boolean;
} | null;

/** What an invite command does (ADR 0124); refusals change nothing. */
export type InvitationDecision =
  | { readonly ok: false; readonly refusal: RoomInvitationRefusal }
  /** A repeat of the same pending invitation: answer it, change nothing. */
  | { readonly ok: true; readonly kind: 'repeat'; readonly invitationId: string }
  | {
      readonly ok: true;
      readonly kind: 'invite';
      readonly inviteeActorId: string;
      readonly seat: RoomSeatKind;
      /** When the invitation, and the seat it holds, lapse. */
      readonly expiresAt: string;
    };

/** What a decline or a withdrawal does. */
export type InvitationEndDecision =
  | { readonly ok: true; readonly state: 'declined' | 'withdrawn' }
  | { readonly ok: false; readonly refusal: RoomInvitationRefusal };

const openStatuses: readonly string[] = ['assembling', 'ready'];

/**
 * What a Room change does to its pending invitations (ADR 0124): a Room no
 * longer open expires them all; otherwise one whose invitee now sits in a
 * seat of its kind is accepted. The rest stay pending. Pure, so the durable
 * adapter applies it under the Room lock of the change it follows.
 */
export function settledRoomInvitations(
  room: Pick<RoomAssemblyState, 'status' | 'participants'>,
  pending: readonly PendingRoomInvitation[],
): readonly {
  readonly id: string;
  readonly inviteeActorId: string;
  readonly state: 'accepted' | 'expired';
}[] {
  if (!openStatuses.includes(room.status))
    return pending.map(({ id, inviteeActorId }) => ({
      id,
      inviteeActorId,
      state: 'expired' as const,
    }));
  const kindOf = (role: string): RoomSeatKind =>
    role === 'judge' ? 'judge' : 'debater';
  return pending
    .filter((invitation) =>
      room.participants.some(
        (p) =>
          p.actorId === invitation.inviteeActorId &&
          kindOf(p.role) === invitation.seat,
      ),
    )
    .map(({ id, inviteeActorId }) => ({
      id,
      inviteeActorId,
      state: 'accepted' as const,
    }));
}
