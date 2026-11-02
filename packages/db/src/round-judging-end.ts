import { and, eq, inArray } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundJudgingJobs } from './schema/round-judging-jobs';

/** A judging job still open when its Round ends has ended too, with that reason. */
export async function endOpenJudgingJobs(
  tx: Pick<BunSQLDatabase, 'update'>,
  roundId: string,
) {
  await tx
    .update(roundJudgingJobs)
    .set({
      status: 'failed',
      terminalReason: 'round_ended',
      retryAt: null,
      leaseTokenDigest: null,
      leaseExpiresAt: null,
      pendingBallot: null,
      pendingBallotAgentRunId: null,
      pendingBallotEpoch: null,
      pendingBallotReceivedAt: null,
    })
    .where(
      and(
        eq(roundJudgingJobs.roundId, roundId),
        inArray(roundJudgingJobs.status, ['queued', 'leased']),
      ),
    );
}
