import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { rounds } from './schema/rounds';
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
