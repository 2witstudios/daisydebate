import { z } from 'zod';
import { capturePartialReasonSchema } from './capture-verdict';
import { debateSides, idSchema } from './primitives';
import { roundRecordSchema } from './round-view';

/** Shared ordered evidence line; text is returned only by protected reads. */
const utteranceFields = {
  id: idSchema,
  segmentId: idSchema,
  segmentSequence: z.int().nonnegative(),
  sequence: z.int().nonnegative(),
  /** Where in its speech the line was captured; null for a line with no clip. */
  startOffsetMs: z.int().nonnegative().nullable(),
  roundParticipantId: idSchema,
  text: z.string(),
  complete: z.boolean(),
};
export const roundUtteranceSchema = z.strictObject(utteranceFields);
/** Raised only when an open tab could not render the new reply correctly. */
export const TRANSCRIPT_CONTRACT_VERSION = 1;
/** The current private transcript audience's snapshot, independent of Round version. */
export const roundTranscriptReadSchema = z.strictObject({
  contractVersion: z.literal(TRANSCRIPT_CONTRACT_VERSION),
  round: roundRecordSchema,
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
      /** Why a partial stream is partial. Empty unless partial. */
      partialReasons: z.array(capturePartialReasonSchema),
      /** Required speech with no capture, as offsets into the speech. Closed or frozen streams only. */
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
/**
 * What a browser needs to render the transcript, and nothing else: a tab left
 * open across a deploy keeps reading through any field added anywhere, the Round
 * view included. Only a raised version or a removed field stops it.
 */
export const liveTranscriptReadSchema = z.looseObject({
  contractVersion: z.literal(TRANSCRIPT_CONTRACT_VERSION),
  round: z.looseObject({
    id: idSchema,
    segments: z
      .array(
        z.looseObject({
          id: idSchema,
          sequence: z.int().nonnegative(),
          rulesSegmentKey: z.string().min(1),
        }),
      )
      .readonly(),
    rules: z.looseObject({
      segments: z
        .array(
          z.looseObject({
            key: z.string(),
            label: z.string(),
            side: z.enum(debateSides),
            slot: z.int().nonnegative(),
          }),
        )
        .readonly(),
    }),
    participants: z
      .array(
        z.looseObject({
          id: idSchema.optional(),
          label: z.string().optional(),
        }),
      )
      .readonly(),
  }),
  revision: z.int().nonnegative(),
  freeze: z
    .looseObject({ completeness: z.enum(['complete', 'incomplete']) })
    .nullable(),
  streams: z.array(
    z.looseObject({
      segmentId: idSchema,
      roundParticipantId: idSchema,
      state: z.enum(['open', 'complete', 'partial']),
      /** Why a partial stream is partial; a newer reason parses and says nothing. */
      partialReasons: z.array(z.string()).optional(),
      gaps: z.array(
        z.looseObject({
          fromOffsetMs: z.int().nonnegative(),
          untilOffsetMs: z.int().nonnegative(),
        }),
      ),
    }),
  ),
  utterances: z.array(z.looseObject(utteranceFields)),
});
export type LiveTranscriptRead = z.infer<typeof liveTranscriptReadSchema>;
