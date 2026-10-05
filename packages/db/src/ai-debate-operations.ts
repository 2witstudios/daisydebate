import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { and, asc, count, eq, gt, gte, isNull, ne, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  aiDebateBallots,
  aiDebateCommands,
  aiDebates,
  aiDebateUtterances,
} from './schema/ai-debates';
import { aiDebateUsageOperations } from './ai-debate-usage';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { isUniqueViolation } from './unique-violation';

import {
  toCommand,
  type AiDebateCommandRecord,
  type AiDebateRecord,
  type AiDebateSide,
  type BallotJson,
  type NewAiDebate,
} from './ai-debate-record';

const DAY_MS = 24 * 60 * 60_000;

/** Caps on AI debates: live at once across everyone, and per person per day. */
export type AiDebateLimits = {
  readonly live: number;
  readonly perDay: number;
};

export type AiDebateCreation = 'created' | 'busy' | 'daily-limit';

/**
 * The AI debate area (AIDB): plain record adapters. The engine folds the
 * command log in `apps/web`; this module never imports it. `sequence` is the
 * concurrency guard: a command or utterance that loses a race is refused
 * with `CONFLICT` and writes nothing.
 */
export const aiDebateOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  ...aiDebateUsageOperations({ database, eventSink }),

  /**
   * Creates an AI debate if the limits allow it, as one atomic step: a
   * transaction-scoped lock serializes creation, so a burst cannot all see
   * room and overshoot. Starting a new debate finishes the actor's other
   * open ones, so one person holds one live seat. A refusal writes nothing.
   */
  async createAiDebate({
    debate,
    now,
    limits,
  }: {
    readonly debate: NewAiDebate;
    readonly now: Date;
    readonly limits: AiDebateLimits;
  }): Promise<AiDebateCreation> {
    return instrumented(eventSink, 'createAiDebate', async () =>
      database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('ai_debates.create'))`,
        );
        const open = and(
          isNull(aiDebates.finishedAt),
          gt(aiDebates.expectedEndAt, now),
        );
        const [today] = await tx
          .select({ n: count() })
          .from(aiDebates)
          .where(
            and(
              eq(aiDebates.actorId, debate.actorId),
              gte(aiDebates.createdAt, new Date(now.getTime() - DAY_MS)),
            ),
          );
        if ((today?.n ?? 0) >= limits.perDay) return 'daily-limit';
        const [others] = await tx
          .select({ n: count() })
          .from(aiDebates)
          .where(and(open, ne(aiDebates.actorId, debate.actorId)));
        if ((others?.n ?? 0) >= limits.live) return 'busy';
        await tx
          .update(aiDebates)
          .set({ finishedAt: now })
          .where(and(eq(aiDebates.actorId, debate.actorId), open));
        await tx.insert(aiDebates).values(debate);
        return 'created';
      }),
    );
  },

  async getAiDebate(id: string): Promise<AiDebateRecord | null> {
    return instrumented(eventSink, 'getAiDebate', async () => {
      const [row] = await database
        .select()
        .from(aiDebates)
        .where(eq(aiDebates.id, id))
        .limit(1);
      if (!row) return null;
      const [commands, utterances, ballots] = await Promise.all([
        database
          .select()
          .from(aiDebateCommands)
          .where(eq(aiDebateCommands.aiDebateId, id))
          .orderBy(asc(aiDebateCommands.sequence)),
        database
          .select()
          .from(aiDebateUtterances)
          .where(eq(aiDebateUtterances.aiDebateId, id))
          .orderBy(asc(aiDebateUtterances.sequence)),
        database
          .select()
          .from(aiDebateBallots)
          .where(eq(aiDebateBallots.aiDebateId, id))
          .limit(1),
      ]);
      const ballot = ballots[0];
      return {
        id: row.id,
        actorId: row.actorId,
        resolution: row.resolution,
        personSide:
          row.personSide === 'affirmative' ? 'affirmative' : 'negative',
        opponent: row.opponent,
        voice: row.voice,
        speechModel: row.speechModel,
        cxModel: row.cxModel,
        judgeModel: row.judgeModel,
        ttsModel: row.ttsModel,
        sttModel: row.sttModel,
        expectedEndAt: row.expectedEndAt,
        createdAt: row.createdAt,
        countedAt: row.countedAt,
        finishedAt: row.finishedAt,
        ttsCharacters: row.ttsCharacters,
        sttRequests: row.sttRequests,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        commands: commands.map(toCommand),
        utterances: utterances.map((u) => ({
          id: u.id,
          sequence: u.sequence,
          turnIndex: u.turnIndex,
          role: u.role === 'ai' ? 'ai' : 'person',
          text: u.text,
          complete: u.complete,
        })),
        ballot: ballot
          ? {
              winner:
                ballot.winner === 'affirmative' ? 'affirmative' : 'negative',
              ballot: ballot.ballot,
            }
          : null,
      };
    });
  },

  /** Appends at `expectedSequence`, the log's current length, or refuses. */
  async appendAiDebateCommand({
    aiDebateId,
    expectedSequence,
    command,
    expectedEndAt,
  }: {
    readonly aiDebateId: string;
    readonly expectedSequence: number;
    readonly command: AiDebateCommandRecord;
    /** Moves the debate's latest end (set when it starts). */
    readonly expectedEndAt?: Date | undefined;
  }): Promise<void> {
    await instrumented(eventSink, 'appendAiDebateCommand', async () => {
      try {
        await database.transaction(async (tx) => {
          const [current] = await tx
            .select({ n: count() })
            .from(aiDebateCommands)
            .where(eq(aiDebateCommands.aiDebateId, aiDebateId));
          if ((current?.n ?? 0) !== expectedSequence)
            throw createAppError('CONFLICT', 'The AI debate moved on');
          await tx.insert(aiDebateCommands).values({
            aiDebateId,
            sequence: expectedSequence,
            type: command.type,
            at: command.at,
            turnIndex: command.type === 'yield' ? command.turnIndex : null,
            reason: command.type === 'abort' ? command.reason : null,
          });
          if (expectedEndAt)
            await tx
              .update(aiDebates)
              .set({ expectedEndAt })
              .where(eq(aiDebates.id, aiDebateId));
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw createAppError('CONFLICT', 'The AI debate moved on', error);
        throw error;
      }
    });
  },

  /**
   * Appends a line after the last one. Lines of one AI debate are numbered
   * one at a time under a lock on its row, so lines arriving together (a
   * late speech chunk and the next turn's first line) all land, in order.
   */
  async appendAiDebateUtterance(input: {
    readonly id: string;
    readonly aiDebateId: string;
    readonly turnIndex: number;
    readonly role: 'person' | 'ai';
    readonly text: string;
    /** False for an AI line the model is still writing. */
    readonly complete?: boolean;
  }): Promise<void> {
    await instrumented(eventSink, 'appendAiDebateUtterance', async () => {
      await database.transaction(async (tx) => {
        await tx
          .select({ id: aiDebates.id })
          .from(aiDebates)
          .where(eq(aiDebates.id, input.aiDebateId))
          .for('update');
        await tx.insert(aiDebateUtterances).values({
          ...input,
          sequence: sql`(select coalesce(max(${aiDebateUtterances.sequence}) + 1, 0) from ${aiDebateUtterances} where ${aiDebateUtterances.aiDebateId} = ${input.aiDebateId})`,
        });
      });
    });
  },

  /**
   * Replaces a line's text (a speech as it grows, or the part of an
   * interrupted reply that was heard), and with `complete` marks whether the
   * line is whole.
   */
  async replaceAiDebateUtterance({
    id,
    aiDebateId,
    text,
    complete,
  }: {
    readonly id: string;
    readonly aiDebateId: string;
    readonly text: string;
    readonly complete?: boolean;
  }): Promise<void> {
    await instrumented(eventSink, 'replaceAiDebateUtterance', async () => {
      await database
        .update(aiDebateUtterances)
        .set(complete === undefined ? { text } : { text, complete })
        .where(
          and(
            eq(aiDebateUtterances.id, id),
            eq(aiDebateUtterances.aiDebateId, aiDebateId),
          ),
        );
    });
  },

  async finishAiDebate(aiDebateId: string): Promise<void> {
    await instrumented(eventSink, 'finishAiDebate', async () => {
      await database
        .update(aiDebates)
        .set({ finishedAt: sql`statement_timestamp()` })
        .where(and(eq(aiDebates.id, aiDebateId), isNull(aiDebates.finishedAt)));
    });
  },

  /** Saves the first ruling only and returns whichever ruling is stored. */
  async saveAiDebateBallot({
    aiDebateId,
    winner,
    ballot,
  }: {
    readonly aiDebateId: string;
    readonly winner: AiDebateSide;
    readonly ballot: BallotJson;
  }): Promise<{ readonly winner: AiDebateSide; readonly ballot: BallotJson }> {
    return instrumented(eventSink, 'saveAiDebateBallot', async () => {
      await database
        .insert(aiDebateBallots)
        .values({ aiDebateId, winner, ballot })
        .onConflictDoNothing();
      const [stored] = await database
        .select()
        .from(aiDebateBallots)
        .where(eq(aiDebateBallots.aiDebateId, aiDebateId))
        .limit(1);
      if (!stored) throw new Error('Ballot insert returned no row');
      return {
        winner: stored.winner === 'affirmative' ? 'affirmative' : 'negative',
        ballot: stored.ballot,
      };
    });
  },
});
