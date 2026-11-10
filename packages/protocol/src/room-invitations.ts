import { z } from 'zod';
import { idSchema } from './primitives';
import { roomSeatKinds, type RoomSeatKind } from './room-contract';
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
