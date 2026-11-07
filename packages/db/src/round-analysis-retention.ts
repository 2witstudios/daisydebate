import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { requireRetentionBounds, type RetentionBatch } from './retention';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { analysisPurgeProjection } from './round-analysis-purge';

/** Purge report content at its retention boundary; the seat cannot become a new request. */
export const roundAnalysisRetention = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  purgeExpiredRoundAnalyses: (batch: RetentionBatch) =>
    instrumented(eventSink, 'purgeExpiredRoundAnalyses', async () => {
      requireRetentionBounds(batch);
      const rows =
        await database.execute(sql`update round_analyses set work=${analysisPurgeProjection}
      where round_participant_id in (select round_participant_id from round_analyses
        where work->>'kind' in ('retained','succeeded') and coalesce((work->>'requestedAt')::timestamptz,created_at)<${batch.before}::timestamptz
        order by created_at,round_participant_id limit ${batch.limit} for update skip locked)
      returning round_participant_id`);
      return rows.length;
    }),
});
