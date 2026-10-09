import { z } from 'zod';
import { idSchema, debateRoleSchema } from './primitives';
import { roomConfigSchema } from './room';
import { roundRulesSchema } from './format';
import { roundStatusSchema } from './round';
/** Durable Launch read grammar; scheduled rounds have no fabricated runtime clock. */
export const roundViewSchema = z.strictObject({
  id: idSchema,
  roomId: idSchema,
  version: z.int().positive(),
  status: roundStatusSchema,
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
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  outcome: z.enum(['affirmative', 'negative', 'draw']).nullable(),
});
export type RoundView = z.infer<typeof roundViewSchema>;
