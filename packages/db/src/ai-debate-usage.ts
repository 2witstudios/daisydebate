import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { and, eq, lte, sql } from 'drizzle-orm';
import { aiDebates } from './schema/ai-debates';
import { instrumented, type DatabaseEventSink } from './instrumented';

/** What an AI debate has used of its vendors: counted, and capped for voice. */
export const aiDebateUsageOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
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

  /**
   * Reserves `characters` of voice against the debate's speech budget, in
   * one guarded update, so requests arriving together can never overshoot
   * it. False when the budget would be passed; nothing is counted then.
   * Like any usage, the first reservation starts counting the debate.
   */
  async reserveAiDebateSpeech({
    aiDebateId,
    characters,
    budget,
  }: {
    readonly aiDebateId: string;
    readonly characters: number;
    readonly budget: number;
  }): Promise<boolean> {
    return instrumented(eventSink, 'reserveAiDebateSpeech', async () => {
      const reserved = await database
        .update(aiDebates)
        .set({
          ttsCharacters: sql`${aiDebates.ttsCharacters} + ${characters}`,
          countedAt: sql`coalesce(${aiDebates.countedAt}, statement_timestamp())`,
        })
        .where(
          and(
            eq(aiDebates.id, aiDebateId),
            lte(sql`${aiDebates.ttsCharacters} + ${characters}`, budget),
          ),
        )
        .returning({ id: aiDebates.id });
      return reserved.length > 0;
    });
  },
});
