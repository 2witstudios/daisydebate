import { z } from 'zod';

/**
 * How a Room's resolution is chosen at creation (ADR 0092, amended by ADR
 * 0142): Freestyle's strike from Daisy's bank, or the host's own wording.
 * Strike rules belong to the product; the host selects only the method.
 */
export const roomResolutionSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('strike') }),
  z.strictObject({
    kind: z.literal('custom'),
    text: z.string().trim().min(1).max(300),
  }),
]);
export type RoomResolutionSelection = z.infer<
  typeof roomResolutionSelectionSchema
>;
