import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  deleteExpiredBatch,
  requireRetentionBounds,
  type RetentionBatch,
} from './retention';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { roundFeedback } from './schema/round-feedback';
import { utterances } from './schema/utterances';

/**
 * Discards a validated pending judging response by ending its job 'failed',
 * the terminal state DEC-201's deadline completes (DEC-223). The whole
 * pending tuple goes in the same statement; the guard trigger refuses any
 * other clear.
 */
export const discardPendingJudgment = sql`status='failed',lease_token_digest=null,lease_expires_at=null,
  pending_ballot=null,pending_ballot_agent_run_id=null,pending_ballot_epoch=null,pending_ballot_received_at=null`;

/**
 * DEC-101 transcripts, DEC-89 judging data and their AI coaching (ADR 0071)
 * are kept 180 days; the sweep
 * applies the window. Each call is one bounded autocommitted statement, as in
 * `deleteExpiredBatch`.
 */
export const transcriptRetention = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  purgeExpiredUtterances: (batch: RetentionBatch) =>
    instrumented(eventSink, 'purgeExpiredUtterances', () =>
      deleteExpiredBatch(
        database,
        { table: utterances, key: utterances.id, at: utterances.createdAt },
        batch,
      ),
    ),
  purgeExpiredRoundFeedback: (batch: RetentionBatch) =>
    instrumented(eventSink, 'purgeExpiredRoundFeedback', () =>
      deleteExpiredBatch(
        database,
        {
          table: roundFeedback,
          key: roundFeedback.roundId,
          at: roundFeedback.createdAt,
        },
        batch,
      ),
    ),
  clearExpiredPendingBallots: ({ before, limit }: RetentionBatch) =>
    instrumented(eventSink, 'clearExpiredPendingBallots', async () => {
      requireRetentionBounds({ before, limit });
      const cleared = await database.execute(sql`
        update round_judging_jobs set ${discardPendingJudgment}
        where (round_id,judge_participant_id) in (
          select round_id,judge_participant_id from round_judging_jobs
          where pending_ballot_received_at < ${before}::timestamptz
          order by pending_ballot_received_at
          limit ${limit}
          for update skip locked
        ) returning round_id`);
      return (cleared as unknown as unknown[]).length;
    }),
});
