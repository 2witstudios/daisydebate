import { asc, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { utterances } from './schema/utterances';
import {
  speechClaimOperations,
  refuseUnscopedTranscriptMutation,
} from './speech-claim-operations';

/** Transcript reads; signed capture operations exclusively own transcript mutations. */
export const utteranceOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  ...speechClaimOperations({ database, eventSink }),
  async appendUtterance(_input: {
    readonly id: string;
    readonly roundId: string;
    readonly segmentId: string;
    readonly roundParticipantId: string;
    readonly text: string;
    readonly complete?: boolean;
    readonly requireOpen: boolean;
    readonly requireEmptySegment?: boolean;
  }): Promise<boolean> {
    return instrumented(eventSink, 'appendUtterance', async () =>
      refuseUnscopedTranscriptMutation(),
    );
  },
  async replaceUtterance(_input: {
    readonly id: string;
    readonly roundId: string;
    readonly text: string;
    readonly complete?: boolean;
    readonly requireOpen: boolean;
    readonly speechToken?: string;
  }): Promise<void> {
    return instrumented(eventSink, 'replaceUtterance', async () =>
      refuseUnscopedTranscriptMutation(),
    );
  },
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
