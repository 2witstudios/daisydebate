import { z } from 'zod';
import { idSchema } from './primitives';
import type { RoomStatus, RoomView } from './room-contract';
import {
  createMessagingCoreSchemas,
  type MessagingCoreBounds,
} from './messaging/core';

/**
 * Caller-specific Room chat authority. The standing says only whether this
 * actor holds a place in the Room (its host or any seat) or may read it
 * without one; no role, seat or judge identity is disclosed.
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
  readonly standing: 'seated' | 'visitor' | null;
};
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
