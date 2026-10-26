import { asc, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { utterances } from './schema/utterances';
/** Transcript reads; signed capture operations exclusively own transcript mutations. */
export const utteranceOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** A segment's lines, in order, for the transcript and the judge. */
  async listSegmentUtterances(segmentId: string) {
    return instrumented(eventSink, 'listSegmentUtterances', async () => {
      const rows = await database
        .select({
          id: utterances.id,
          roundParticipantId: utterances.roundParticipantId,
          sequence: utterances.sequence,
          text: utterances.text,
          complete: utterances.complete,
          createdAt: utterances.createdAt,
        })
        .from(utterances)
        .where(eq(utterances.segmentId, segmentId));
      return rows.sort((a, b) => a.sequence - b.sequence);
    });
  },

  /** A round's whole transcript, in insertion order. */
  async listRoundUtterances(roundId: string) {
    return instrumented(eventSink, 'listRoundUtterances', async () => {
      return database
        .select({
          id: utterances.id,
          segmentId: utterances.segmentId,
          roundParticipantId: utterances.roundParticipantId,
          text: utterances.text,
          complete: utterances.complete,
          createdAt: utterances.createdAt,
        })
        .from(utterances)
        .where(eq(utterances.roundId, roundId))
        .orderBy(asc(utterances.createdAt), asc(utterances.sequence));
    });
  },
});
