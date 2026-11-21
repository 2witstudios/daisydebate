import { z } from 'zod';
import { idSchema } from './primitives';
import { isOpenRoomStatus, type RoomAssemblyState } from './room-contract';
import { seatKindSchema, type SeatKind } from './seats';
import { usernameSchema as username } from './username';

/**
 * An invitation names a kind of seat: a side's seat is for any side, as a
 * challenge's hold is, and the host still arranges sides.
 */
export const roomInvitationStates = [
  'pending',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
] as const;

/** How long an unanswered invitation holds its seat. */
export const ROOM_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

export const roomInvitationCommandSchemas = {
  /** The host invites one member by username. */
  invite: z.strictObject({
    version: z.literal(1),
    username,
    seat: seatKindSchema,
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

/**
 * One pending invitation as its Room's host and its invitee read it: the
 * host sees every one, an invitee only their own (ADR 0124).
 */
export const roomInvitationViewSchema = z.strictObject({
  id: idSchema,
  seat: seatKindSchema,
  invitee: z.string(),
  inviter: z.string(),
  expiresAt: z.iso.datetime(),
});
export type RoomInvitationView = z.infer<typeof roomInvitationViewSchema>;

/** A pending invitation as the Room holds it. */
export type PendingRoomInvitation = {
  readonly id: string;
  readonly inviteeActorId: string;
  readonly inviterActorId: string;
  readonly seat: SeatKind;
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
  | {
      readonly ok: true;
      readonly kind: 'repeat';
      readonly invitationId: string;
    }
  | {
      readonly ok: true;
      readonly kind: 'invite';
      readonly inviteeActorId: string;
      readonly seat: SeatKind;
      /** When the invitation, and the seat it holds, lapse. */
      readonly expiresAt: string;
    };

/** What a decline or a withdrawal does. */
export type InvitationEndDecision =
  | { readonly ok: true; readonly state: 'declined' | 'withdrawn' }
  | { readonly ok: false; readonly refusal: RoomInvitationRefusal };

/**
 * What a Room change does to its pending invitations (ADR 0124): a Room no
 * longer open expires them all; otherwise one whose invitee now sits in a
 * seat is settled, accepted when the seat is of its kind and expired when
 * they chose another, so its hold never outlives their arrival. The rest
 * stay pending. Pure, so the durable adapter applies it under the Room lock
 * of the change it follows.
 */
export function settledRoomInvitations(
  room: Pick<RoomAssemblyState, 'status' | 'participants'>,
  pending: readonly PendingRoomInvitation[],
): readonly {
  readonly id: string;
  readonly inviteeActorId: string;
  readonly state: 'accepted' | 'expired';
}[] {
  if (!isOpenRoomStatus(room.status))
    return pending.map(({ id, inviteeActorId }) => ({
      id,
      inviteeActorId,
      state: 'expired' as const,
    }));
  return pending.flatMap(({ id, inviteeActorId, seat }) => {
    const taken = room.participants.find((p) => p.actorId === inviteeActorId);
    if (!taken) return [];
    return [
      {
        id,
        inviteeActorId,
        state:
          taken.seat.kind === seat
            ? ('accepted' as const)
            : ('expired' as const),
      },
    ];
  });
}
