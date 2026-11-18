import { z } from 'zod';
import { idSchema } from './primitives';
import type { RoundStatus } from './round';
import {
  createMessagingCoreSchemas,
  type MessagingCoreBounds,
} from './messaging/core';

/** Caller-specific Round authority. No judge roster or judge identity is disclosed. */
export type RoundFloorFact = {
  readonly kind: 'round_floor';
  readonly roundId: string;
  readonly channelId: string | null;
  readonly policyKey: 'round.floor';
  readonly policyRevision: 1;
  readonly revision: number;
  readonly status: RoundStatus;
  readonly completedAt: string | null;
  readonly actorId: string;
  /**
   * The caller's place in the floor's audience. A youth debater's linked adult
   * watching a Youth Round reads it and posts nothing (ADR 0155); the
   * boundary names them, since the Round's own facts do not.
   */
  readonly audience: 'debater' | 'host' | 'linked_adult' | null;
};
/**
 * The floor fact with a Youth Round's linked adult named (ADR 0155): someone
 * the Round seats nowhere and does not host, but whom the boundary read as
 * linked to one of its youth debaters. `youth` is null on every other Round.
 */
export const withLinkedAdultAudience = (
  fact: RoundFloorFact,
  youth: { readonly linkedAdultActorIds: readonly string[] } | null,
): RoundFloorFact =>
  fact.audience === null &&
  youth?.linkedAdultActorIds.includes(fact.actorId) === true
    ? { ...fact, audience: 'linked_adult' }
    : fact;
export const roundFloorRetentionMs = 180 * 24 * 60 * 60 * 1000;

/** Floor transport shares Messaging commands and the validated history projection. */
export function createRoundFloorSchemas(bounds: MessagingCoreBounds) {
  const core = createMessagingCoreSchemas(bounds);
  return {
    ...core,
    open: z.strictObject({ version: z.literal(1), roundId: idSchema }),
    metadata: z.strictObject({
      version: z.literal(1),
      roundId: idSchema,
      channelId: idSchema,
      readOnly: z.boolean(),
      expiresAt: z.iso.datetime().nullable(),
    }),
  };
}
