import type { Ballot } from '@daisy/protocol';
import { sql } from 'drizzle-orm';

/**
 * The ballots row a submitted ruling writes: the parsed contract decomposed
 * into its columns, on the judge's seat, stamped by PostgreSQL.
 */
export const ballotRowOf = (input: {
  readonly ballotId: string;
  readonly judgeParticipantId: string;
  readonly ballot: Ballot;
}) => ({
  id: input.ballotId,
  judgeParticipantId: input.judgeParticipantId,
  rubricVersion: input.ballot.rubricVersion,
  winner: input.ballot.winner,
  scores: input.ballot.scores,
  reason: input.ballot.reason,
  feedback: input.ballot.feedback,
  citations: input.ballot.citations ?? null,
  status: 'submitted' as const,
  submittedAt: sql`statement_timestamp()` as unknown as Date,
});
