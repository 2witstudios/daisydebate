import { roundStatus, emptyRuntimeCheckpointFor } from '@daisy/protocol/round';
import { roundRulesSchema, type RoundRules } from '@daisy/protocol/format';
import { frozenJudgingFor } from '@daisy/protocol/ballot-definition';
import { readDatabaseTime } from './database-clock';
import { createAppError } from '@daisy/errors';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { hydrateRound, type RoundHydration } from './round-hydration';
import { isUniqueViolation } from './driver-failure';
import { rounds } from './schema/rounds';
import type { TxSource } from './tx';

export const roundOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** Read-only wall-clock prediction; lifecycle authority is sampled inside execution. */
  async databaseNow(): Promise<string> {
    return instrumented(eventSink, 'databaseNow', async () =>
      (await readDatabaseTime(database)).toISOString(),
    );
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
    /** A Round with no Room seats no one at Start, so it never rates. */
    readonly competitionType: 'casual';
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
          status: roundStatus.opening,
          ladderId: null,
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
