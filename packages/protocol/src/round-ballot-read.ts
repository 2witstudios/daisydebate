import { z } from 'zod';
import { ballotSchema } from './ballot';
import { idSchema } from './primitives';
import { roundViewSchema } from './round-view';

const ballotStatus = z.enum(['submitted', 'voided']);
/** A caller's own judge seat is private; other judges' seats never accompany ballots. */
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
      utterances: z.array(
        z.strictObject({
          id: idSchema,
          segmentId: idSchema,
          segmentSequence: z.int().nonnegative(),
          sequence: z.int().nonnegative(),
          roundParticipantId: idSchema,
          text: z.string(),
          complete: z.boolean(),
        }),
      ),
    })
    .nullable(),
  ballots: z.array(
    z.strictObject({ status: ballotStatus, ballot: ballotSchema }),
  ),
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
