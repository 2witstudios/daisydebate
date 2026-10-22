import { z } from 'zod';
import { idSchema } from './primitives';
const instant = z.iso.datetime({ offset: true });
const frame = z
  .strictObject({
    trackId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    sequence: z.number().int().min(0).max(2147483647),
    pcm: z.array(z.number().int().min(-32768).max(32767)).length(160),
    beforeMs: z.number().finite(),
    afterMs: z.number().finite(),
    serverWindow: z.strictObject({ before: instant, after: instant }),
    receivedAt: instant,
  })
  .refine(
    (value) =>
      value.beforeMs <= value.afterMs &&
      Date.parse(value.serverWindow.before) <=
        Date.parse(value.serverWindow.after) &&
      Date.parse(value.serverWindow.after) <= Date.parse(value.receivedAt),
  );
/** Private ephemeral relay envelope assembled only after authenticated media admission. */
export const botActivityBatchSchema = z.strictObject({
  version: z.literal(1),
  roundId: idSchema,
  roundParticipantId: idSchema,
  frames: z.array(frame).min(1).max(20),
});
