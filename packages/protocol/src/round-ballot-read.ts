import { z } from 'zod';
import { capturePartialReasonSchema } from './capture-verdict';
import { storedBallotSchema } from './ballot';
import { idSchema } from './primitives';
import { roundViewSchema } from './round-view';
import { roundUtteranceSchema } from './round-transcript';

/**
 * A caller's own judge seat is private; other judges' seats never accompany
 * ballots, only whether a human or the AI judged. A ballot's feedback for a
 * side reaches only that side's debater.
 */
export const roundBallotReadSchema = z.strictObject({
  round: roundViewSchema,
  own: z
    .strictObject({
      participantId: idSchema,
      ballot: storedBallotSchema.nullable(),
      freezeRevision: z.int().positive().nullable(),
    })
    .nullable(),
  freeze: z
    .strictObject({
      revision: z.int().positive(),
      frontier: z.int().nonnegative(),
      frozenAt: z.iso.datetime(),
      completeness: z.enum(['complete', 'incomplete']),
      utterances: z.array(roundUtteranceSchema),
    })
    .nullable(),
  ballots: z.array(
    z.strictObject({
      judge: z.enum(['human', 'ai']),
      ballot: storedBallotSchema,
      /**
       * This ballot's id when it carries feedback for the reader, who alone
       * may report that feedback (WATCH-7). It names no judge. Null otherwise.
       */
      reportableFeedbackId: idSchema.nullable(),
    }),
  ),
  /**
   * A seated participant's frozen transcript of the completed Round; null for
   * anyone else or a Round that never froze one.
   */
  transcript: z
    .strictObject({
      completeness: z.enum(['complete', 'incomplete']),
      utterances: z.array(roundUtteranceSchema),
      /** Required speech with no capture, by stream. */
      gaps: z.array(
        z.strictObject({
          segmentId: idSchema,
          roundParticipantId: idSchema,
          fromOffsetMs: z.int().nonnegative(),
          untilOffsetMs: z.int().nonnegative(),
        }),
      ),
      /** Every partial stream and why, including one with no gaps. */
      partialStreams: z.array(
        z.strictObject({
          segmentId: idSchema,
          roundParticipantId: idSchema,
          reasons: z.array(capturePartialReasonSchema).min(1),
        }),
      ),
    })
    .nullable(),
});
export type RoundBallotRead = z.infer<typeof roundBallotReadSchema>;
/** Only the caller's own judge assignments; no other judge identity is included. */
export const roundJudgeAssignmentsSchema = z.array(
  z.strictObject({
    roundId: idSchema,
    /** Null until a draw's reveal, and for a Round that ended before it. */
    resolution: z.string().nullable(),
    status: roundViewSchema.shape.status,
    outcome: roundViewSchema.shape.outcome,
    ballotSubmitted: z.boolean(),
    freezeRevision: z.int().positive().nullable(),
  }),
);
export type RoundJudgeAssignment = z.infer<
  typeof roundJudgeAssignmentsSchema
>[number];
