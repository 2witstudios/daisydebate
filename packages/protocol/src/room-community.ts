import { z } from 'zod';
import { idSchema } from './primitives';
import type { RoomStatus, RoomView } from './room-contract';
import type { LobbyAgeRule } from './lobby/eligibility';
import type { SeatKind } from './seats';
import {
  createMessagingCoreSchemas,
  type MessagingCoreBounds,
} from './messaging/core';

export const roomCommunityPolicySchema = z.object({
  policyKey: z.literal('room.community'),
  policyRevision: z.literal(1),
});

/**
 * Caller-specific Room chat authority: raw facts about the Room and about this
 * one actor (whether they host it, and their own seat). `decideRoomCommunity`
 * derives what they may do. It says nothing about anyone else and never
 * reaches the wire; the caller is told only whether their chat is read-only.
 */
export type RoomCommunityFact = Readonly<
  z.infer<typeof roomCommunityPolicySchema>
> & {
  readonly kind: 'room_community';
  readonly roomId: string;
  readonly channelId: string | null;
  readonly revision: number;
  readonly status: RoomStatus;
  readonly visibility: RoomView['visibility'];
  /** When the Room started or closed; null exactly while it is open. */
  readonly endedAt: string | null;
  readonly actorId: string;
  /** Whether this actor hosts the Room. */
  readonly host: boolean;
  /** This actor's own seat, or null when they hold none. */
  readonly seatKind: SeatKind | null;
  /** The Room is a Youth Room (`youthRoomOf`, decision 84). */
  readonly youthRoom: boolean;
  /**
   * This actor is club staff of a youth debater seated in the Room: an adult
   * who owns, or holds a live grant whose role carries `school.roster.manage`
   * in, a school where that debater is an active member. False outside a Youth
   * Room, and for a caller who holds a seat or hosts: they post anyway.
   */
  readonly youthStaff: boolean;
};
/**
 * A human judge reads Room chat and never posts in it: a judge is anonymous to
 * the debaters (DEC-174), and a message under a username would name them. No
 * seat reads only when there is none.
 */
export const roomCommunitySeatReadsOnly = (
  seatKind: SeatKind | null,
): boolean => seatKind === 'judge';
/**
 * A Youth Room (decision 84): a Room of the Youth lobby, casual included
 * (ADR 0162). `daisy_room_community_fact` reads the same rule in SQL.
 */
export const youthRoomOf = (room: {
  readonly ageRule: LobbyAgeRule;
}): boolean => room.ageRule === 'under-18';
/**
 * Who reads Room chat while it gathers and never posts: a judge (DEC-174), and
 * in a Youth Room anyone without a seat there (decision 84), adult or minor,
 * unless they host it or are a seated youth debater's club staff. Nobody is
 * told why from an age: the facts name seats and roles only.
 */
export const roomCommunityReadsOnly = (
  fact: Pick<
    RoomCommunityFact,
    'seatKind' | 'host' | 'youthRoom' | 'youthStaff'
  >,
): boolean =>
  roomCommunitySeatReadsOnly(fact.seatKind) ||
  (fact.youthRoom && fact.seatKind === null && !fact.host && !fact.youthStaff);
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
