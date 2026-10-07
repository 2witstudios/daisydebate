import { z } from 'zod';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { roundParticipants } from './schema/round-participants';
import { jsonObjectSchema } from './schema/columns';
import { rounds } from './schema/rounds';
import { agentRuns } from './schema/agent-runs';
import { usageReservations } from './schema/usage-reservations';

/**
 * The AI area on the shared model (ADR 0058 §8): one row per execution in
 * `agent_runs`, and entitlement accounting in `usage_reservations` — kept
 * off the kernel, where a human-human round never sees it.
 */
export const agentOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * Records one execution's consumption. Cost accounting only: no rule
   * reads it, so a failure here must never fail the round.
   */
  async recordAgentRun(input: {
    readonly id: string;
    readonly roundParticipantId: string;
    readonly kind: 'speech' | 'cross_ex' | 'tts' | 'stt' | 'judging';
    readonly model: string | null;
    readonly provider: string;
    readonly configurationSnapshot?: z.infer<typeof jsonObjectSchema>;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly characters?: number;
    readonly requests?: number;
    readonly endedAt?: Date | null;
  }): Promise<void> {
    await instrumented(eventSink, 'recordAgentRun', async () => {
      await database.insert(agentRuns).values({
        id: input.id,
        roundParticipantId: input.roundParticipantId,
        kind: input.kind,
        model: input.model,
        provider: input.provider,
        configurationSnapshot: input.configurationSnapshot ?? {},
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        characters: input.characters ?? 0,
        requests: input.requests ?? 0,
        startedAt: sql`statement_timestamp()` as unknown as Date,
        endedAt: input.endedAt ?? null,
      });
    });
  },

  /** The TTS characters already spent by a seat this round. */
  async spokenCharactersFor(input: {
    readonly roundParticipantId: string;
  }): Promise<number> {
    return instrumented(eventSink, 'spokenCharactersFor', async () => {
      const [row] = await database
        .select({
          characters: sql<number>`coalesce(sum(${agentRuns.characters}), 0)`,
        })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.roundParticipantId, input.roundParticipantId),
            eq(agentRuns.kind, 'tts'),
          ),
        );
      return Number(row?.characters ?? 0);
    });
  },

  /**
   * Reserves the actor's AI-practice allowance for one round; a repeated
   * reserve for the same round is the same reservation.
   */
  async reserveAiPractice(input: {
    readonly id: string;
    readonly actorId: string;
    readonly roundId: string;
  }): Promise<void> {
    await instrumented(eventSink, 'reserveAiPractice', async () => {
      await database
        .insert(usageReservations)
        .values({
          id: input.id,
          actorId: input.actorId,
          roundId: input.roundId,
          kind: 'ai_practice',
        })
        .onConflictDoNothing();
    });
  },

  /** Stamps counted_at on the reservation's first billable call. */
  async markReservationCounted(input: {
    readonly actorId: string;
    readonly roundId: string;
  }): Promise<void> {
    await instrumented(eventSink, 'markReservationCounted', async () => {
      await database
        .update(usageReservations)
        .set({ countedAt: sql`statement_timestamp()` as unknown as Date })
        .where(
          and(
            eq(usageReservations.actorId, input.actorId),
            eq(usageReservations.roundId, input.roundId),
            eq(usageReservations.kind, 'ai_practice'),
            isNull(usageReservations.countedAt),
          ),
        );
    });
  },

  /** How many AI-practice reservations the actor made inside the window. */
  async countRecentAiPractice(input: {
    readonly actorId: string;
    readonly since: Date;
  }): Promise<number> {
    return instrumented(eventSink, 'countRecentAiPractice', async () => {
      const [row] = await database
        .select({ n: sql<number>`count(*)` })
        .from(usageReservations)
        .innerJoin(rounds, eq(rounds.id, usageReservations.roundId))
        .where(
          and(
            eq(usageReservations.actorId, input.actorId),
            eq(usageReservations.kind, 'ai_practice'),
            gte(rounds.createdAt, input.since),
          ),
        );
      return Number(row?.n ?? 0);
    });
  },
});
