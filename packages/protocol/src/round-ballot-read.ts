import { z } from 'zod';
import { ballotLimits, ballotSchema } from './ballot';
import { idSchema } from './primitives';
import { roundViewSchema } from './round-view';

const ballotStatus = z.enum(['submitted', 'voided']);
const utteranceSchema = z.strictObject({
  id: idSchema,
  segmentId: idSchema,
  segmentSequence: z.int().nonnegative(),
  sequence: z.int().nonnegative(),
  roundParticipantId: idSchema,
  text: z.string(),
  complete: z.boolean(),
});

/**
 * A debater's own AI coaching for a completed Round (ADR 0071): written,
 * carried on the AI judge's ballot, still being written, or not available.
 */
export const roundCoachingSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    text: z.string().trim().min(1).max(ballotLimits.feedback),
  }),
  z.strictObject({ status: z.literal('in-ballot') }),
  z.strictObject({ status: z.literal('pending') }),
  z.strictObject({ status: z.literal('unavailable') }),
]);
export type RoundCoaching = z.infer<typeof roundCoachingSchema>;

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
      status: ballotStatus.nullable(),
      ballot: ballotSchema.nullable(),
      freezeRevision: z.int().positive().nullable(),
    })
    .nullable(),
  freeze: z
    .strictObject({
      revision: z.int().positive(),
      frontier: z.int().nonnegative(),
      frozenAt: z.iso.datetime(),
      completeness: z.enum(['complete', 'incomplete']),
      utterances: z.array(utteranceSchema),
    })
    .nullable(),
  ballots: z.array(
    z.strictObject({
      status: ballotStatus,
      judge: z.enum(['human', 'ai']),
      ballot: ballotSchema,
    }),
  ),
  /**
   * A seated participant's frozen transcript of the completed Round; null for
   * anyone else or a Round that never froze one.
   */
  transcript: z
    .strictObject({
      completeness: z.enum(['complete', 'incomplete']),
      utterances: z.array(utteranceSchema),
    })
    .nullable(),
  /** The caller's own coaching when they debated the completed Round; null otherwise. */
  coaching: roundCoachingSchema.nullable(),
});
export type RoundBallotRead = z.infer<typeof roundBallotReadSchema>;
/** Only the caller's own judge assignments; no other judge identity is included. */
export const roundJudgeAssignmentsSchema = z.array(
  z.strictObject({
    roundId: idSchema,
    resolution: z.string(),
    status: roundViewSchema.shape.status,
    outcome: roundViewSchema.shape.outcome,
    ballotStatus: ballotStatus.nullable(),
    freezeRevision: z.int().positive().nullable(),
  }),
);
export type RoundJudgeAssignment = z.infer<
  typeof roundJudgeAssignmentsSchema
>[number];
