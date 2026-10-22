import { z } from 'zod';
import { ballotSchema } from './ballot';
import { idSchema } from './primitives';
import type { RatedOutcome } from './ratings';
import type { RoundCommandAuthority } from './round-command';

/** Human and bot judges submit the same rubric against one immutable input revision. */
export const roundBallotEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  expectedVersion: z.int().positive(),
  judgeParticipantId: idSchema,
  freezeRevision: z.int().positive(),
  ballot: ballotSchema,
});
export type RoundBallotEnvelope = z.infer<typeof roundBallotEnvelopeSchema>;
/** The stored submission result replays exactly, even after another judge completes the Round. */
export type RoundBallotReceipt = {
  readonly commandId: string;
  readonly roundId: string;
  readonly ballotId: string;
  readonly judgeParticipantId: string;
  readonly freezeRevision: number;
  readonly resultingVersion: number;
  readonly outcome: RatedOutcome | null;
};
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
