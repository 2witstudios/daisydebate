import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { and, asc, count, eq, gt, isNull, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  aiDebateBallots,
  aiDebateCommands,
  aiDebates,
  aiDebateUtterances,
} from './schema/ai-debates';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { isUniqueViolation } from './unique-violation';

export type AiDebateSide = 'affirmative' | 'negative';

export type AiDebateCommandRecord =
  | { readonly type: 'start'; readonly at: Date }
  | { readonly type: 'startSpeech'; readonly at: Date }
  | { readonly type: 'yield'; readonly at: Date; readonly turnIndex: number }
  | {
      readonly type: 'abort';
      readonly at: Date;
      readonly reason: 'person' | 'vendor-failure';
    };

export type AiDebateUtteranceRecord = {
  readonly id: string;
  readonly sequence: number;
  readonly turnIndex: number;
  readonly role: 'person' | 'ai';
  readonly text: string;
};

export type NewAiDebate = {
  readonly id: string;
  readonly actorId: string;
  readonly resolution: string;
  readonly personSide: AiDebateSide;
  readonly voice: string;
  readonly speechModel: string;
  readonly cxModel: string;
  readonly judgeModel: string;
  readonly ttsModel: string;
  readonly sttModel: string;
  readonly expectedEndAt: Date;
};

export type AiDebateRecord = NewAiDebate & {
  readonly createdAt: Date;
  readonly countedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly ttsCharacters: number;
  readonly sttRequests: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly commands: readonly AiDebateCommandRecord[];
  readonly utterances: readonly AiDebateUtteranceRecord[];
  readonly ballot: {
    readonly winner: AiDebateSide;
    readonly ballot: BallotJson;
  } | null;
};

type CommandRow = typeof aiDebateCommands.$inferSelect;
/** A JSON object, as the ballot column stores it. */
export type BallotJson = (typeof aiDebateBallots.$inferSelect)['ballot'];

const toCommand = (row: CommandRow): AiDebateCommandRecord => {
  if (row.type === 'yield')
    return { type: 'yield', at: row.at, turnIndex: row.turnIndex ?? 0 };
  if (row.type === 'abort')
    return {
      type: 'abort',
      at: row.at,
      reason: row.reason === 'vendor-failure' ? 'vendor-failure' : 'person',
    };
  return {
    type: row.type === 'startSpeech' ? 'startSpeech' : 'start',
    at: row.at,
  };
};

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
  async createAiDebate(input: NewAiDebate): Promise<void> {
    await instrumented(eventSink, 'createAiDebate', async () => {
      await database.insert(aiDebates).values(input);
    });
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
  }: {
    readonly aiDebateId: string;
    readonly expectedSequence: number;
    readonly command: AiDebateCommandRecord;
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
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw createAppError('CONFLICT', 'The AI debate moved on', error);
        throw error;
      }
    });
  },

  /** Appends a line after the last one; a lost race is a `CONFLICT`. */
  async appendAiDebateUtterance(input: {
    readonly id: string;
    readonly aiDebateId: string;
    readonly turnIndex: number;
    readonly role: 'person' | 'ai';
    readonly text: string;
  }): Promise<void> {
    await instrumented(eventSink, 'appendAiDebateUtterance', async () => {
      try {
        await database.insert(aiDebateUtterances).values({
          ...input,
          sequence: sql`(select coalesce(max(${aiDebateUtterances.sequence}) + 1, 0) from ${aiDebateUtterances} where ${aiDebateUtterances.aiDebateId} = ${input.aiDebateId})`,
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw createAppError(
            'CONFLICT',
            'Another line was added first',
            error,
          );
        throw error;
      }
    });
  },

  /** Replaces a line's text (the part of an interrupted reply that was heard). */
  async replaceAiDebateUtterance({
    id,
    aiDebateId,
    text,
  }: {
    readonly id: string;
    readonly aiDebateId: string;
    readonly text: string;
  }): Promise<void> {
    await instrumented(eventSink, 'replaceAiDebateUtterance', async () => {
      await database
        .update(aiDebateUtterances)
        .set({ text })
        .where(
          and(
            eq(aiDebateUtterances.id, id),
            eq(aiDebateUtterances.aiDebateId, aiDebateId),
          ),
        );
    });
  },

  /**
   * Adds vendor usage to the debate's internal cost and, on the first call,
   * stamps `counted_at`: from then the debate counts against an allowance.
   */
  async recordAiDebateUsage({
    aiDebateId,
    ttsCharacters = 0,
    sttRequests = 0,
    promptTokens = 0,
    completionTokens = 0,
  }: {
    readonly aiDebateId: string;
    readonly ttsCharacters?: number;
    readonly sttRequests?: number;
    readonly promptTokens?: number;
    readonly completionTokens?: number;
  }): Promise<void> {
    await instrumented(eventSink, 'recordAiDebateUsage', async () => {
      await database
        .update(aiDebates)
        .set({
          ttsCharacters: sql`${aiDebates.ttsCharacters} + ${ttsCharacters}`,
          sttRequests: sql`${aiDebates.sttRequests} + ${sttRequests}`,
          promptTokens: sql`${aiDebates.promptTokens} + ${promptTokens}`,
          completionTokens: sql`${aiDebates.completionTokens} + ${completionTokens}`,
          countedAt: sql`coalesce(${aiDebates.countedAt}, statement_timestamp())`,
        })
        .where(eq(aiDebates.id, aiDebateId));
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

  /** AI debates not finished whose latest possible end is after `now`. */
  async countLiveAiDebates(now: Date): Promise<number> {
    return instrumented(eventSink, 'countLiveAiDebates', async () => {
      const [row] = await database
        .select({ n: count() })
        .from(aiDebates)
        .where(
          and(isNull(aiDebates.finishedAt), gt(aiDebates.expectedEndAt, now)),
        );
      return row?.n ?? 0;
    });
  },

  /** How many of an actor's AI debates started counting at or after `since`. */
  async countCountedAiDebates({
    actorId,
    since,
  }: {
    readonly actorId: string;
    readonly since: Date;
  }): Promise<number> {
    return instrumented(eventSink, 'countCountedAiDebates', async () => {
      const [row] = await database
        .select({ n: count() })
        .from(aiDebates)
        .where(
          and(
            eq(aiDebates.actorId, actorId),
            sql`${aiDebates.countedAt} >= ${since}`,
          ),
        );
      return row?.n ?? 0;
    });
  },
});
