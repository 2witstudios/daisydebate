import { z } from 'zod';
import { idSchema } from './primitives';
import { roundViewSchema } from './round-view';

/** Shared ordered evidence line; text is returned only by protected reads. */
export const roundUtteranceSchema = z.strictObject({
  id: idSchema,
  segmentId: idSchema,
  segmentSequence: z.int().nonnegative(),
  sequence: z.int().nonnegative(),
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
    }),
  ),
  utterances: z.array(roundUtteranceSchema),
});
export type RoundTranscriptRead = z.infer<typeof roundTranscriptReadSchema>;
