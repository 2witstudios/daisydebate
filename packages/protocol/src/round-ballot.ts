import { z } from 'zod';
import { ballotRecordSchema } from './ballot-schema';
import { idSchema } from './primitives';
import { roundOutcomeSchema } from './round-outcome';
import type { RoundCommandAuthority } from './round-command';

/**
 * Human and bot judges submit the same rubric against one immutable input
 * revision; the Round's own ballot schema judges the ballot it carries.
 */
export const roundBallotEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  expectedVersion: z.int().positive(),
  judgeParticipantId: idSchema,
  freezeRevision: z.int().positive(),
  ballot: ballotRecordSchema,
});
export type RoundBallotEnvelope = z.infer<typeof roundBallotEnvelopeSchema>;
/** The stored submission result replays exactly, even after another judge completes the Round. */
export const roundBallotReceiptSchema = z.strictObject({
  commandId: idSchema,
  roundId: idSchema,
  ballotId: idSchema,
  judgeParticipantId: idSchema,
  freezeRevision: z.int().positive(),
  resultingVersion: z.int().positive(),
  outcome: roundOutcomeSchema.nullable(),
});
export type RoundBallotReceipt = z.infer<typeof roundBallotReceiptSchema>;
/** Locked canonical authority; a judging run cannot borrow another run's seat or purpose. */
export type RoundBallotAuthority = Omit<
  RoundCommandAuthority,
  'hostActorId' | 'agentRun'
> & {
  readonly agentRun:
    | (NonNullable<RoundCommandAuthority['agentRun']> & {
        readonly kind: string;
      })
    | null;
};
