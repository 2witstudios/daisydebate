import { z } from 'zod';
import { idSchema } from './primitives';

/** Stretches of speech a freeze found with no transcript, as offsets into each speech. */
export const frozenCaptureGapsSchema = z.strictObject({
  gaps: z
    .array(
      z.strictObject({
        segmentId: idSchema,
        roundParticipantId: idSchema,
        fromOffsetMs: z.int().nonnegative(),
        untilOffsetMs: z.int().nonnegative(),
      }),
    )
    .readonly(),
});
export type FrozenCaptureGaps = z.infer<typeof frozenCaptureGapsSchema>;
