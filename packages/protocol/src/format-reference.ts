import { z } from 'zod';
/** An immutable published format revision, independent of a Room or event. */
export const formatRevisionPinSchema = z.strictObject({
  formatId: z.string().trim().min(1),
  formatVersion: z.int().positive(),
});
