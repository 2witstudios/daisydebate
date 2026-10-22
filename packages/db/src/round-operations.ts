import { sampleRoundExecutionTime } from './round-execution-time';
import { writeSpeakingProjection } from './round-speaking-writer';
import type { RoundProjection, RoundRules } from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import type { z } from 'zod';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { hydrateRound, type RoundHydration } from './round-hydration';
import {
  insertCommandRow,
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { isUniqueViolation } from './unique-violation';
import { roundCommands } from './schema/round-commands';
import { rounds } from './schema/rounds';
import { jsonObjectSchema } from './schema/columns';

/** Server-owned pure projection builder, invoked with the post-lock PostgreSQL instant. */
export type RoundExecutionWrite = {
  readonly command: {
    readonly commandId: string;
    readonly actorId: string | null;
    readonly serviceId: string | null;
    readonly type: string;
    readonly payloadDigest: string;
    readonly result: z.infer<typeof jsonObjectSchema>;
  } | null;
  readonly buildProjection: (now: string) => RoundProjection;
};

const persistExecution = async (
  tx: Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0],
  input: RoundExecutionWrite & { readonly roundId: string },
  current: Awaited<ReturnType<typeof lockedRoundVersion>>,
  projection: RoundProjection,
  now: string,
): Promise<void> => {
  const changed = await writeProjectionWithPhaseSignal(
    tx,
    input.roundId,
    current,
    projection,
    now,
  );
  await insertCommandRow(
    tx,
    input.roundId,
    input.command,
    current.version + (changed ? 1 : 0),
  );
  await writeSpeakingProjection(tx, {
    roundId: input.roundId,
    projection,
    resultingVersion: current.version + (changed ? 1 : 0),
    commandId: input.command?.commandId ?? null,
  });
};

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
    readonly competitionType: 'ranked' | 'casual' | 'practice';
    readonly length: 'full' | 'quick';
    readonly formatId: string;
    readonly formatVersion: number;
    readonly presetVersion: number | null;
    readonly rules: RoundRules;
  }): Promise<void> {
    await instrumented(eventSink, 'createRound', async () => {
      const ladder =
        input.competitionType === 'ranked'
          ? input.length === 'full'
            ? 'ranked'
            : 'quick'
          : null;
      try {
        await database.insert(rounds).values({
          id: input.id,
          createdByActorId: input.createdByActorId,
          resolution: input.resolution,
          competitionType: input.competitionType,
          length: input.length,
          formatId: input.formatId,
          formatVersion: input.formatVersion,
          presetVersion: input.presetVersion,
          rulesSnapshot: input.rules,
          status: 'scheduled',
          ladderId: ladder,
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

  /**
   * Persists one execution: the command row (idempotency — a replayed
   * command id refuses with its stored result), the projection's segment
   * writes, and the round-row columns, guarded by the round's optimistic
   * version so a round that moved under a concurrent command refuses with
   * CONFLICT and writes nothing.
   */
  async applyRoundExecution(
    input: {
      readonly roundId: string;
      readonly expectedVersion: number;
    } & RoundExecutionWrite,
  ): Promise<void> {
    await instrumented(eventSink, 'applyRoundExecution', async () => {
      await database.transaction(async (tx) => {
        if (input.command !== null) {
          const [existing] = await tx
            .select({ commandId: roundCommands.commandId })
            .from(roundCommands)
            .where(eq(roundCommands.commandId, input.command.commandId))
            .limit(1);
          if (existing)
            throw createAppError('CONFLICT', 'The command was already applied');
        }
        const roundVersion = await lockedRoundVersion(
          tx,
          input.roundId,
          input.expectedVersion,
        );
        const now = await sampleRoundExecutionTime(tx);
        const projection = input.buildProjection(now);
        await persistExecution(tx, input, roundVersion, projection, now);
      });
    });
  },
});
