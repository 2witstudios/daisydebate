import { z } from 'zod';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { jsonObjectSchema } from './schema/columns';
import { rounds } from './schema/rounds';
import { agentRuns } from './schema/agent-runs';
import { usageReservations } from './schema/usage-reservations';
import { roundParticipants } from './schema/round-participants';

/** The TTS characters a seat has already spent this round, summed. */
const spentOnSpeech = (
  client:
    | Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0]
    | BunSQLDatabase,
  roundParticipantId: string,
) =>
  client
    .select({
      characters: sql<number>`coalesce(sum(${agentRuns.characters}), 0)`,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.roundParticipantId, roundParticipantId),
        eq(agentRuns.kind, 'tts'),
      ),
    );

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
    readonly configurationSnapshot?:
      z.infer<typeof jsonObjectSchema> | undefined;
    readonly inputTokens?: number | undefined;
    readonly outputTokens?: number | undefined;
    readonly characters?: number | undefined;
    readonly requests?: number | undefined;
    readonly endedAt?: Date | null | undefined;
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

  /**
   * Claims `characters` from a seat's voice budget, or reports that it could
   * not. Returns whether the claim was made.
   *
   * Reading the total and then writing the usage was a check-then-act across
   * the vendor call: two requests that asked for phrases at the same moment
   * both read the same spent total, both passed, and both called the vendor —
   * so the budget was a ceiling on paper only. This claims the characters
   * first, in one transaction that locks the seat row, so concurrent requests
   * queue on it and each sees the previous claim. The vendor call happens after
   * this returns, never inside the lock.
   *
   * A vendor failure after the claim leaves the characters spent. That
   * over-counts rather than under-counts, which is the safe direction for a
   * budget that exists to cap spend.
   */
  async reserveSpokenCharacters(input: {
    readonly id: string;
    readonly roundParticipantId: string;
    readonly characters: number;
    readonly budget: number;
    readonly model: string;
    readonly provider: string;
  }): Promise<boolean> {
    return instrumented(eventSink, 'reserveSpokenCharacters', async () => {
      return database.transaction(async (tx) => {
        // Serialises concurrent claims on this seat. The row is otherwise
        // untouched, so this is a lock and not a write.
        const [seat] = await tx
          .select({ id: roundParticipants.id })
          .from(roundParticipants)
          .where(eq(roundParticipants.id, input.roundParticipantId))
          .for('update');
        if (!seat) return false;
        const [spent] = await spentOnSpeech(tx, input.roundParticipantId);
        if (Number(spent?.characters ?? 0) + input.characters > input.budget)
          return false;
        await tx.insert(agentRuns).values({
          id: input.id,
          roundParticipantId: input.roundParticipantId,
          kind: 'tts',
          model: input.model,
          provider: input.provider,
          configurationSnapshot: {},
          inputTokens: 0,
          outputTokens: 0,
          characters: input.characters,
          requests: 1,
          startedAt: sql`statement_timestamp()` as unknown as Date,
          endedAt: null,
        });
        return true;
      });
    });
  },

  /** The TTS characters already spent by a seat this round. */
  async spokenCharactersFor(input: {
    readonly roundParticipantId: string;
  }): Promise<number> {
    return instrumented(eventSink, 'spokenCharactersFor', async () => {
      const [row] = await spentOnSpeech(database, input.roundParticipantId);
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

  /**
   * Rounds nobody has finished, across everyone.
   *
   * This is the global ceiling on live AI practice: each live round holds
   * seats, a reservation and a voice budget, so without a global count every
   * member's personal allowance multiplies out. `scheduled` and `active` are
   * the two unfinished statuses; `completed` and `abandoned` have given their
   * resources back.
   *
   * The pre-cutover query also required the round's latest possible end to be
   * still in the future, which counted a debate whose clock had run out as
   * live. Under the one-Round model a round that has not been completed is
   * still open work — nothing reaps it — so `status` is the whole truth here,
   * and a stale `active` row correctly keeps counting until something finishes
   * it rather than silently ceasing to occupy capacity.
   */
  async countLiveRounds(): Promise<number> {
    return instrumented(eventSink, 'countLiveRounds', async () => {
      const [row] = await database
        .select({ n: sql<number>`count(*)` })
        .from(rounds)
        .where(inArray(rounds.status, ['scheduled', 'active'] as const));
      return Number(row?.n ?? 0);
    });
  },
});
