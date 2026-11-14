import {
  emptyRuntimeCheckpointFor,
  roundRulesSchema,
  type CompetitionType,
  type RoundRules,
} from '@daisy/protocol';
import { frozenJudgingFor } from './round-judging-freeze';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { hydrateRound, type RoundHydration } from './round-hydration';
import { isUniqueViolation } from './unique-violation';
import { roundLadder, rounds } from './schema/rounds';

export const roundOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** Read-only wall-clock prediction; lifecycle authority is sampled inside execution. */
  async databaseNow(): Promise<string> {
    return instrumented(eventSink, 'databaseNow', async () => {
      const [row] = (await database.execute(
        sql`select clock_timestamp() as now`,
      )) as unknown as Array<{ now: Date }>;
      if (!row)
        throw createAppError('INFRASTRUCTURE', 'The clock is unreadable');
      return row.now.toISOString();
    });
  },

  /**
   * Creates a round that froze without a Room — the foundation proof and
   * service-created rounds. Every value is already resolved by the caller;
   * the insert computes nothing.
   */
  async createRound(input: {
    readonly id: string;
    readonly createdByActorId: string | null;
    readonly resolution: string;
    readonly competitionType: CompetitionType;
    readonly formatId: string;
    readonly formatVersion: number;
    readonly presetVersion: number | null;
    readonly rules: RoundRules;
  }): Promise<void> {
    await instrumented(eventSink, 'createRound', async () => {
      // The checkpoint and judging are read from the rules, so the rules are
      // checked first: a malformed body is a typed refusal, never a crash.
      const parsed = roundRulesSchema.safeParse(input.rules);
      if (!parsed.success)
        throw createAppError(
          'VALIDATION',
          'Invalid value for jsonb column rules_snapshot',
          parsed.error,
        );
      try {
        await database.insert(rounds).values({
          id: input.id,
          createdByActorId: input.createdByActorId,
          resolution: input.resolution,
          competitionType: input.competitionType,
          formatId: input.formatId,
          formatVersion: input.formatVersion,
          presetVersion: input.presetVersion,
          rulesSnapshot: input.rules,
          judging: frozenJudgingFor(input.rules),
          runtimeState: emptyRuntimeCheckpointFor(input.rules),
          status: 'opening',
          ladderId: roundLadder(input.competitionType, input.formatId),
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw createAppError('CONFLICT', 'The round already exists', error);
        throw error;
      }
    });
  },

  /** The hydration view: durable truth for one round, in one read. */
  async getRound(id: string): Promise<RoundHydration | null> {
    return instrumented(eventSink, 'getRound', () =>
      hydrateRound(database, id),
    );
  },
});
