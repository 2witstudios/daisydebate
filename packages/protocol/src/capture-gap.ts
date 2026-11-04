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
        /**
         * platform: the platform lost it. edge: capture was not yet, or no longer, reading
         * at the speech's start or end. unattributed: possibly a silent or muted seat.
         */
        cause: z.enum(['platform', 'edge', 'unattributed']),
      }),
    )
    .readonly(),
});
export type FrozenCaptureGaps = z.infer<typeof frozenCaptureGapsSchema>;
