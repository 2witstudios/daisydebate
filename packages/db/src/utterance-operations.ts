import { and, asc, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { roundSegments } from './schema/round-segments';
import { utterances } from './schema/utterances';
import { speechClaimOperations } from './speech-claim-operations';
import { lockUtteranceSegment } from './utterance-segment-lock';

type ReplaceInput = {
  readonly id: string;
  readonly roundId: string;
  readonly text: string;
  readonly complete?: boolean;
  readonly requireOpen: boolean;
  readonly speechToken?: string;
};
type WriteDatabase = Pick<BunSQLDatabase, 'select' | 'update' | 'execute'>;

const assertSpeechClaim = async (
  tx: WriteDatabase,
  input: ReplaceInput,
  line: {
    readonly generationToken: string | null;
    readonly generationExpiresAt: Date | null;
  },
) => {
  if (line.generationToken !== null && input.speechToken === undefined)
    throw createAppError('CONFLICT', 'Speech claim required');
  if (input.speechToken === undefined) return;
  const [instant] = (await tx.execute(
    sql`select statement_timestamp() as now`,
  )) as unknown as Array<{ now: Date }>;
  if (
    line.generationToken !== input.speechToken ||
    line.generationExpiresAt === null ||
    line.generationExpiresAt.getTime() <= instant!.now.getTime()
  )
    throw createAppError('CONFLICT', 'Speech claim expired');
};

const assertOpenReplacement = async (
  tx: WriteDatabase,
  input: ReplaceInput,
) => {
  const [initial] = await tx
    .select({ segmentId: utterances.segmentId })
    .from(utterances)
    .where(
      and(eq(utterances.id, input.id), eq(utterances.roundId, input.roundId)),
    );
  if (!initial) throw createAppError('NOT_FOUND', 'No such utterance');
  const [segment] = await tx
    .select({ endedAt: roundSegments.endedAt })
    .from(roundSegments)
    .where(
      and(
        eq(roundSegments.id, initial.segmentId),
        eq(roundSegments.roundId, input.roundId),
      ),
    )
    .for('update');
  if (!segment || segment.endedAt !== null)
    throw createAppError('CONFLICT', 'The segment is closed');
  // Re-read after the lock: a takeover may have replaced the token while waiting.
  const [line] = await tx
    .select({
      generationToken: utterances.generationToken,
      generationExpiresAt: utterances.generationExpiresAt,
    })
    .from(utterances)
    .where(eq(utterances.id, input.id));
  if (!line) throw createAppError('NOT_FOUND', 'No such utterance');
  await assertSpeechClaim(tx, input, line);
};

const replacementValues = (input: ReplaceInput) => {
  if (input.speechToken === undefined)
    return input.complete === undefined
      ? { text: input.text }
      : { text: input.text, complete: input.complete };
  return {
    text: input.text,
    ...(input.complete === undefined ? {} : { complete: input.complete }),
    generationToken: input.complete === true ? null : input.speechToken,
    generationExpiresAt:
      input.complete === true
        ? null
        : (sql`statement_timestamp() + interval '120 seconds'` as unknown as Date),
  };
};

const writeReplacement = async (tx: WriteDatabase, input: ReplaceInput) => {
  if (input.requireOpen) await assertOpenReplacement(tx, input);
  const updated = await tx
    .update(utterances)
    .set(replacementValues(input))
    .where(
      and(
        eq(utterances.id, input.id),
        eq(utterances.roundId, input.roundId),
        ...(input.speechToken === undefined
          ? []
          : [
              eq(utterances.generationToken, input.speechToken),
              sql`${utterances.generationExpiresAt} > statement_timestamp()`,
            ]),
      ),
    )
    .returning({ id: utterances.id });
  if (input.speechToken !== undefined && updated.length === 0)
    throw createAppError('CONFLICT', 'Speech claim expired');
};

/** Ordered, durable lines within one Round segment (ADR 0058 §6). */
export const utteranceOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  ...speechClaimOperations({ database, eventSink }),

  async appendUtterance(input: {
    readonly id: string;
    readonly roundId: string;
    readonly segmentId: string;
    readonly roundParticipantId: string;
    readonly text: string;
    readonly complete?: boolean;
    /** Require the segment row to still be open when this line lands. */
    readonly requireOpen: boolean;
    /** Insert an opening only if this segment still has no lines. */
    readonly requireEmptySegment?: boolean;
  }): Promise<boolean> {
    return instrumented(eventSink, 'appendUtterance', async () => {
      return database.transaction(async (tx) => {
        const segment = await lockUtteranceSegment(tx, input);
        if (!segment) throw createAppError('NOT_FOUND', 'No such segment');
        if (input.requireOpen && segment.endedAt !== null)
          throw createAppError('CONFLICT', 'The segment is closed');
        if (input.requireEmptySegment) {
          const [existing] = await tx
            .select({ id: utterances.id })
            .from(utterances)
            .where(eq(utterances.segmentId, input.segmentId))
            .limit(1);
          if (existing) return false;
        }
        await tx.insert(utterances).values({
          id: input.id,
          roundId: input.roundId,
          segmentId: input.segmentId,
          roundParticipantId: input.roundParticipantId,
          text: input.text,
          complete: input.complete ?? true,
          sequence: sql`(select coalesce(max(${utterances.sequence}) + 1, 0) from ${utterances} where ${utterances.segmentId} = ${input.segmentId})`,
        });
        return true;
      });
    });
  },

  /** Replace a growing speech or record only the part heard. */
  async replaceUtterance(input: {
    readonly id: string;
    readonly roundId: string;
    readonly text: string;
    readonly complete?: boolean;
    /** Require the line's segment to remain open during this replacement. */
    readonly requireOpen: boolean;
    /** Current speech claim; every replacement renews and fences it. */
    readonly speechToken?: string;
  }): Promise<void> {
    await instrumented(eventSink, 'replaceUtterance', async () => {
      if (input.speechToken !== undefined && !input.requireOpen)
        throw createAppError(
          'INVARIANT',
          'Speech writes require an open segment',
        );
      if (input.requireOpen)
        await database.transaction((tx) => writeReplacement(tx, input));
      else await writeReplacement(database, input);
    });
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
