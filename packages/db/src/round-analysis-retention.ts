import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { deleteExpiredBatch, type RetentionBatch } from './retention';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { roundAnalyses } from './schema/round-analyses';

/** Round analyses are kept 180 days from job creation, like the transcript they read; the sweep applies the window. */
export const roundAnalysisRetention = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  purgeExpiredRoundAnalyses: (batch: RetentionBatch) =>
    instrumented(eventSink, 'purgeExpiredRoundAnalyses', () =>
      deleteExpiredBatch(
        database,
        {
          table: roundAnalyses,
          key: roundAnalyses.roundParticipantId,
          at: roundAnalyses.createdAt,
        },
        batch,
      ),
    ),
});
