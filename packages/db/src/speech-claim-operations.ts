import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { utterances } from './schema/utterances';
import { lockUtteranceSegment } from './utterance-segment-lock';

/** Owns one bot speech generation per live segment across processes. */
export const speechClaimOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** One durable, expiring writer claim for a bot speech line. */
  async claimSpeech(input: {
    readonly id: string;
    readonly roundId: string;
    readonly segmentId: string;
    readonly roundParticipantId: string;
    readonly token: string;
  }): Promise<
    | { readonly status: 'claimed'; readonly utteranceId: string }
    | { readonly status: 'held' | 'complete'; readonly utteranceId: string }
  > {
    return instrumented(eventSink, 'claimSpeech', async () =>
      database.transaction(async (tx) => {
        const segment = await lockUtteranceSegment(tx, input);
        if (!segment || segment.type !== 'speech' || segment.endedAt !== null)
          throw createAppError('CONFLICT', 'The speech segment is closed');
        const [nowRow] = (await tx.execute(
          sql`select statement_timestamp() as now`,
        )) as unknown as Array<{ now: Date }>;
        const now = nowRow!.now;
        const expiresAt = new Date(now.getTime() + 120_000);
        const [existing] = await tx
          .select({
            id: utterances.id,
            complete: utterances.complete,
            generationExpiresAt: utterances.generationExpiresAt,
          })
          .from(utterances)
          .where(
            and(
              eq(utterances.segmentId, input.segmentId),
              eq(utterances.roundParticipantId, input.roundParticipantId),
            ),
          )
          .limit(1);
        if (existing?.complete)
          return { status: 'complete' as const, utteranceId: existing.id };
        if (existing) {
          if (
            existing.generationExpiresAt !== null &&
            existing.generationExpiresAt.getTime() > now.getTime()
          )
            return { status: 'held' as const, utteranceId: existing.id };
          await tx
            .update(utterances)
            .set({
              text: '',
              generationToken: input.token,
              generationExpiresAt: expiresAt,
            })
            .where(eq(utterances.id, existing.id));
          return { status: 'claimed' as const, utteranceId: existing.id };
        }
        await tx.insert(utterances).values({
          id: input.id,
          roundId: input.roundId,
          segmentId: input.segmentId,
          roundParticipantId: input.roundParticipantId,
          sequence: sql`(select coalesce(max(${utterances.sequence}) + 1, 0) from ${utterances} where ${utterances.segmentId} = ${input.segmentId})`,
          text: '',
          complete: false,
          generationToken: input.token,
          generationExpiresAt: expiresAt,
        });
        return { status: 'claimed' as const, utteranceId: input.id };
      }),
    );
  },

  /** A cancelled stream gives up only its own claim. */
  async releaseSpeech(input: {
    readonly utteranceId: string;
    readonly roundId: string;
    readonly token: string;
  }): Promise<void> {
    await instrumented(eventSink, 'releaseSpeech', async () => {
      await database
        .update(utterances)
        .set({ generationToken: null, generationExpiresAt: null })
        .where(
          and(
            eq(utterances.id, input.utteranceId),
            eq(utterances.roundId, input.roundId),
            eq(utterances.generationToken, input.token),
          ),
        );
    });
  },
});
