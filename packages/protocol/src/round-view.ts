import { z } from 'zod';
import { idSchema, debateRoleSchema } from './primitives';
import { roomConfigSchema } from './room';
import { roundRulesSchema, segmentTypes } from './format';
import {
  competitionTypes,
  roundStatusSchema,
  runtimeCheckpointSchema,
} from './round';

const instant = z.iso.datetime({ offset: true });

/**
 * Durable Launch read grammar plus the runtime snapshot (checkpoint and
 * segment rows) a client derives the live position from with the shared
 * reader (`@daisy/debate-engine/position`); no position is precomputed.
 */
export const roundViewSchema = z.strictObject({
  id: idSchema,
  roomId: idSchema,
  version: z.int().positive(),
  status: roundStatusSchema,
  competitionType: z.enum(competitionTypes),
  topic: z.string().min(1),
  visibility: z.enum(['public', 'unlisted', 'private']),
  hostActorId: idSchema.nullable(),
  config: roomConfigSchema,
  rules: roundRulesSchema,
  participants: z
    .array(
      z.strictObject({
        id: idSchema,
        actorId: idSchema,
        kind: z.enum(['human', 'bot']),
        label: z.string(),
        role: debateRoleSchema,
        slot: z.int().nonnegative(),
      }),
    )
    .readonly(),
  startedAt: instant.nullable(),
  completedAt: instant.nullable(),
  outcome: z.enum(['affirmative', 'negative', 'draw']).nullable(),
  checkpoint: runtimeCheckpointSchema,
  segments: z
    .array(
      z.strictObject({
        id: idSchema,
        sequence: z.int().nonnegative(),
        type: z.enum(segmentTypes),
        rulesSegmentKey: z.string().min(1),
        startedAt: instant,
        endedAt: instant.nullable(),
        durationMs: z.int().positive(),
      }),
    )
    .readonly(),
});
export type RoundView = z.infer<typeof roundViewSchema>;
