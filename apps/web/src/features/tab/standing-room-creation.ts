import { z } from 'zod';
import { idSchema } from '@daisy/protocol/primitives';
import { roomConfigSchema } from '@daisy/protocol/room';
import { roomCreateSchema } from '@daisy/protocol/room-contract';
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
  recording: z.strictObject({
    value: z.enum(['on', 'off']),
    locked: z.boolean(),
  }),
  rating: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('unrated') }),
    z.strictObject({ kind: z.literal('rated'), ladderId: idSchema }),
    z.strictObject({ kind: z.literal('unsupported') }),
  ]),
  visibility: z.strictObject({
    value: roomCreateSchema.shape.visibility,
    locked: z.boolean(),
  }),
});
export type StandingRoomCreation = z.infer<typeof standingRoomCreationSchema>;
