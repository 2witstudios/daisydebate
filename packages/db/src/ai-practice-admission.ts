import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { rounds } from './schema/rounds';
import { roundSegments } from './schema/round-segments';
import { usageReservations } from './schema/usage-reservations';
import { roomParticipants, rooms } from './schema/rooms';
import { roundParticipants } from './schema/round-participants';
import { newRoomValues, seatsComplete, type NewRoom } from './room-operations';

export type AiPracticeAdmission = {
  readonly room: NewRoom;
  readonly seats: readonly [
    {
      readonly id: string;
      readonly actorId: string;
      readonly role: 'affirmative' | 'negative';
    },
    {
      readonly id: string;
      readonly actorId: string;
      readonly role: 'affirmative' | 'negative';
    },
    { readonly id: string; readonly actorId: string; readonly role: 'judge' },
  ];
  readonly roundId: string;
  readonly resolution: string;
  readonly reservationId: string;
  readonly actorId: string;
  readonly since: Date;
  readonly limits: { readonly live: number; readonly perDay: number };
};

type Client =
  BunSQLDatabase | Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];

export const liveAiPracticeCount = (client: Client) =>
  client
    .select({ n: sql<number>`count(*)` })
    .from(usageReservations)
    .innerJoin(rounds, eq(rounds.id, usageReservations.roundId))
    .where(
      and(
        eq(usageReservations.kind, 'ai_practice'),
        inArray(rounds.status, ['scheduled', 'active'] as const),
      ),
    );

export const recentAiPracticeCount = (
  client: Client,
  actorId: string,
  since: Date,
) =>
  client
    .select({ n: sql<number>`count(*)` })
    .from(usageReservations)
    .innerJoin(rounds, eq(rounds.id, usageReservations.roundId))
    .where(
      and(
        eq(usageReservations.actorId, actorId),
        eq(usageReservations.kind, 'ai_practice'),
        gte(rounds.createdAt, since),
      ),
    );

/**
 * Reclaim unstarted sessions after 15 minutes and active sessions after two
 * hours without a durable execution. Lock rounds before their segments, just
 * like execution, so a concurrent command either refreshes activity first or
 * sees the abandonment's new version. Status remains the capacity authority.
 */
const reclaimAiPractice = async (
  tx: Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0],
) => {
  const stale = await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(
      and(
        inArray(
          rounds.id,
          tx
            .select({ id: usageReservations.roundId })
            .from(usageReservations)
            .where(eq(usageReservations.kind, 'ai_practice')),
        ),
        or(
          and(
            eq(rounds.status, 'scheduled'),
            sql`${rounds.updatedAt} < statement_timestamp() - interval '15 minutes'`,
          ),
          and(
            eq(rounds.status, 'active'),
            sql`${rounds.updatedAt} < statement_timestamp() - interval '2 hours'`,
          ),
        ),
      ),
    )
    .for('update');
  if (stale.length === 0) return;
  const ids = stale.map((row) => row.id);
  await tx
    .update(roundSegments)
    .set({ endedAt: sql`statement_timestamp()` })
    .where(
      and(
        inArray(roundSegments.roundId, ids),
        sql`${roundSegments.endedAt} is null`,
      ),
    );
  await tx
    .update(rounds)
    .set({
      status: 'abandoned',
      currentStage: null,
      outcome: null,
      completedAt: sql`statement_timestamp()`,
      updatedAt: sql`statement_timestamp()`,
      version: sql`${rounds.version} + 1`,
      runtimeState: {
        version: 1,
        prep_consumed_ms: { affirmative: 0, negative: 0 },
        active_prep: null,
        floor: null,
      },
    })
    .where(inArray(rounds.id, ids));
};

/** Serializes admission, allowance checks, assembly, freeze and reservation. */
export async function admitAiPractice(
  database: BunSQLDatabase,
  eventSink: DatabaseEventSink | undefined,
  input: AiPracticeAdmission,
): Promise<void> {
  await instrumented(eventSink, 'admitAiPractice', async () => {
    await database.transaction(async (tx) => {
      // One global admission lane makes both caps exact under concurrent starts.
      await tx.execute(sql`select pg_advisory_xact_lock(21011058)`);
      await reclaimAiPractice(tx);
      const [live] = await liveAiPracticeCount(tx);
      if (Number(live?.n ?? 0) >= input.limits.live)
        throw createAppError('RATE_LIMIT', 'Too many live AI debates');
      const [recent] = await recentAiPracticeCount(
        tx,
        input.actorId,
        input.since,
      );
      if (Number(recent?.n ?? 0) >= input.limits.perDay)
        throw createAppError('RATE_LIMIT', 'Daily AI debate limit');
      const room = input.room;
      if (
        room.competitionType !== 'practice' ||
        room.executionPlan.preRoundPrep.enabled
      )
        throw createAppError(
          'INVARIANT',
          'AI practice needs a direct-start practice room',
        );
      if (
        !seatsComplete(
          room.rules.seats,
          input.seats.map((seat) => ({ role: seat.role, slot: 0 })),
        )
      )
        throw createAppError('INVARIANT', 'The room has incomplete seats');
      await tx.insert(rooms).values(newRoomValues(room, 'started'));
      await tx.insert(roomParticipants).values(
        input.seats.map((seat) => ({
          id: seat.id,
          roomId: room.id,
          actorId: seat.actorId,
          role: seat.role,
          slot: 0,
        })),
      );
      await tx.insert(rounds).values({
        id: input.roundId,
        roomId: room.id,
        resolution: input.resolution,
        competitionType: 'practice',
        length: room.length,
        formatId: room.formatId,
        formatVersion: room.formatVersion,
        presetVersion: null,
        rulesSnapshot: room.rules,
        status: 'scheduled',
        ladderId: null,
      });
      await tx.insert(roundParticipants).values(
        input.seats.map((seat) => ({
          id: seat.id,
          roundId: input.roundId,
          actorId: seat.actorId,
          role: seat.role,
          slot: 0,
        })),
      );
      await tx.insert(usageReservations).values({
        id: input.reservationId,
        actorId: input.actorId,
        roundId: input.roundId,
        kind: 'ai_practice',
      });
    });
  });
}
