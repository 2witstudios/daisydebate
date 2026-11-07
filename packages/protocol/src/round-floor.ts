import { z } from 'zod';
import { idSchema } from './primitives';
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
  readonly status: 'opening' | 'active' | 'completed' | 'abandoned';
  readonly completedAt: string | null;
  readonly actorId: string;
  readonly audience: 'debater' | 'host' | null;
};
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
