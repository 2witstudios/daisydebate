import { z } from 'zod';
import { idSchema } from './primitives';

/** Publication identity is supplied instead of trusting text returned by a client. */
export const publishedResolutionSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['policy', 'value']),
  text: z.string().trim().min(1).max(300),
  provenance: z.string().trim().min(1),
  publishedAt: z.iso.datetime({ offset: true }),
});
export type PublishedResolution = z.infer<typeof publishedResolutionSchema>;

/** Strike rules belong to the product; the host selects only the method. */
export const roomResolutionSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('policy'), id: idSchema }),
  z.strictObject({ kind: z.literal('value'), id: idSchema }),
  z.strictObject({ kind: z.literal('strike') }),
  z.strictObject({
    kind: z.literal('custom'),
    text: z.string().trim().min(1).max(300),
  }),
]);
export type RoomResolutionSelection = z.infer<
  typeof roomResolutionSelectionSchema
>;
