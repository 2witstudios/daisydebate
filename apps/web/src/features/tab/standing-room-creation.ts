import { z } from 'zod';
import { idSchema, roomConfigSchema } from '@daisy/protocol';
export const standingRoomSelectionSchema = z.strictObject({
  kind: z.literal('catalog'),
  formatId: z.string().min(1),
  formatVersion: z.int().positive(),
  presetVersion: z.int().positive(),
  competitionType: z.literal('casual'),
});
export const standingRoomCreationSchema = z.strictObject({
  selection: standingRoomSelectionSchema,
  config: roomConfigSchema,
  resolutionChoicePolicy: z.strictObject({
    method: z.enum(['fixed', 'draw', 'strike']),
    ownText: z.boolean(),
    choices: z.array(
      z.strictObject({ id: idSchema, text: z.string().trim().min(1).max(300) }),
    ),
  }),
  rating: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('unrated') }),
    z.strictObject({ kind: z.literal('rated'), ladderId: idSchema }),
    z.strictObject({ kind: z.literal('unsupported') }),
  ]),
  visibility: z.strictObject({
    value: z.enum(['public', 'unlisted', 'private']),
    locked: z.boolean(),
  }),
});
export type StandingRoomCreation = z.infer<typeof standingRoomCreationSchema>;
