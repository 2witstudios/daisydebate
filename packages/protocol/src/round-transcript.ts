import { z } from 'zod';
import { idSchema } from './primitives';
import { roundViewSchema } from './round-view';

/** Shared ordered evidence line; text is returned only by protected reads. */
export const roundUtteranceSchema = z.strictObject({
  id: idSchema,
  segmentId: idSchema,
  segmentSequence: z.int().nonnegative(),
  sequence: z.int().nonnegative(),
  /** Where in its speech the line was captured; null for a line with no clip. */
  startOffsetMs: z.int().nonnegative().nullable(),
  roundParticipantId: idSchema,
  text: z.string(),
  complete: z.boolean(),
});
/** The current private transcript audience's snapshot, independent of Round version. */
export const roundTranscriptReadSchema = z.strictObject({
  round: roundViewSchema,
  revision: z.int().nonnegative(),
  freeze: z
    .strictObject({
      completeness: z.enum(['complete', 'incomplete']),
    })
    .nullable(),
  streams: z.array(
    z.strictObject({
      segmentId: idSchema,
      roundParticipantId: idSchema,
      state: z.enum(['open', 'complete', 'partial']),
      /** Required speech with no capture, as offsets into the speech. Closed streams only. */
      gaps: z.array(
        z.strictObject({
          fromOffsetMs: z.int().nonnegative(),
          untilOffsetMs: z.int().nonnegative(),
        }),
      ),
    }),
  ),
  utterances: z.array(roundUtteranceSchema),
});
export type RoundTranscriptRead = z.infer<typeof roundTranscriptReadSchema>;
