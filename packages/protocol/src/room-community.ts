import { z } from 'zod';
import { idSchema } from './primitives';
import {
  seatKindOf,
  type RoomParticipant,
  type RoomStatus,
  type RoomView,
} from './room-contract';
import {
  createMessagingCoreSchemas,
  type MessagingCoreBounds,
} from './messaging/core';

/**
 * Caller-specific Room chat authority: raw facts about the Room and about this
 * one actor (whether they host it, and their own seat). `decideRoomCommunity`
 * derives what they may do. It says nothing about anyone else and never
 * reaches the wire; the caller is told only whether their chat is read-only.
 */
export type RoomCommunityFact = {
  readonly kind: 'room_community';
  readonly roomId: string;
  readonly channelId: string | null;
  readonly policyKey: 'room.community';
  readonly policyRevision: 1;
  readonly revision: number;
  readonly status: RoomStatus;
  readonly visibility: RoomView['visibility'];
  /** When the Room started or closed; null exactly while it is open. */
  readonly endedAt: string | null;
  readonly actorId: string;
  /** Whether this actor hosts the Room. */
  readonly host: boolean;
  /** This actor's own seat, or null when they hold none. */
  readonly seatRole: RoomParticipant['role'] | null;
};
/**
 * A human judge reads Room chat and never posts in it: a judge is anonymous to
 * the debaters (DEC-174), and a message under a username would name them. No
 * seat reads only when there is none.
 */
export const roomCommunitySeatReadsOnly = (
  seatRole: RoomParticipant['role'] | null,
): boolean => seatRole !== null && seatKindOf(seatRole) === 'judge';
/** Rows outlive the conversation for reports, export and erasure only. */
export const roomCommunityRetentionMs = 180 * 24 * 60 * 60 * 1000;

/** Room chat transport shares Messaging commands and the validated history projection. */
export function createRoomCommunitySchemas(bounds: MessagingCoreBounds) {
  const core = createMessagingCoreSchemas(bounds);
  return {
    ...core,
    open: z.strictObject({ version: z.literal(1), roomId: idSchema }),
    metadata: z.strictObject({
      version: z.literal(1),
      roomId: idSchema,
      channelId: idSchema,
      readOnly: z.boolean(),
      expiresAt: z.iso.datetime().nullable(),
    }),
  };
}
