import { z } from 'zod';
import { ballotSchema } from './ballot';
import { idSchema } from './primitives';
import { roundViewSchema } from './round-view';
import { roundUtteranceSchema } from './round-transcript';

const ballotStatus = z.enum(['submitted', 'voided']);

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
      utterances: z.array(roundUtteranceSchema),
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
      utterances: z.array(roundUtteranceSchema),
    })
    .nullable(),
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
