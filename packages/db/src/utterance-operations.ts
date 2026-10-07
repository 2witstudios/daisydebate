import { and, asc, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { roundSegments } from './schema/round-segments';
import { utterances } from './schema/utterances';

/**
 * What was said, in order (ADR 0058 §6): utterances belong to a segment,
 * appended one at a time under a lock on the round's rows, so lines
 * arriving together land in order.
 */
export const utteranceOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async appendUtterance(input: {
    readonly id: string;
    readonly roundId: string;
    readonly segmentId: string;
    readonly roundParticipantId: string;
    readonly text: string;
    readonly complete?: boolean;
    /** Require the segment row to still be open when this line lands. */
    readonly requireOpen: boolean;
  }): Promise<void> {
    await instrumented(eventSink, 'appendUtterance', async () => {
      await database.transaction(async (tx) => {
        const [segment] = await tx
          .select({ endedAt: roundSegments.endedAt })
          .from(roundSegments)
          .where(
            and(
              eq(roundSegments.id, input.segmentId),
              eq(roundSegments.roundId, input.roundId),
            ),
          )
          .for('update');
        if (!segment) throw createAppError('NOT_FOUND', 'No such segment');
        if (input.requireOpen && segment.endedAt !== null)
          throw createAppError('CONFLICT', 'The segment is closed');
        await tx.insert(utterances).values({
          id: input.id,
          roundId: input.roundId,
          segmentId: input.segmentId,
          roundParticipantId: input.roundParticipantId,
          text: input.text,
          complete: input.complete ?? true,
          sequence: sql`(select coalesce(max(${utterances.sequence}) + 1, 0) from ${utterances} where ${utterances.segmentId} = ${input.segmentId})`,
        });
      });
    });
  },

  /**
   * Replaces a line's text (a speech as it grows, or the part of an
   * interrupted reply that was heard), and with `complete` marks whether
   * the line is whole.
   */
  async replaceUtterance(input: {
    readonly id: string;
    readonly roundId: string;
    readonly text: string;
    readonly complete?: boolean;
    /** Require the line's segment to remain open during this replacement. */
    readonly requireOpen: boolean;
  }): Promise<void> {
    await instrumented(eventSink, 'replaceUtterance', async () => {
      const update = async (tx: Pick<BunSQLDatabase, 'select' | 'update'>) => {
        if (input.requireOpen) {
          const [line] = await tx
            .select({ segmentId: utterances.segmentId })
            .from(utterances)
            .where(
              and(
                eq(utterances.id, input.id),
                eq(utterances.roundId, input.roundId),
              ),
            );
          if (!line) throw createAppError('NOT_FOUND', 'No such utterance');
          const [segment] = await tx
            .select({ endedAt: roundSegments.endedAt })
            .from(roundSegments)
            .where(
              and(
                eq(roundSegments.id, line.segmentId),
                eq(roundSegments.roundId, input.roundId),
              ),
            )
            .for('update');
          if (!segment || segment.endedAt !== null)
            throw createAppError('CONFLICT', 'The segment is closed');
        }
        await tx
          .update(utterances)
          .set(
            input.complete === undefined
              ? { text: input.text }
              : { text: input.text, complete: input.complete },
          )
          .where(
            and(
              eq(utterances.id, input.id),
              eq(utterances.roundId, input.roundId),
            ),
          );
      };
      if (input.requireOpen) await database.transaction(update);
      else await update(database);
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
