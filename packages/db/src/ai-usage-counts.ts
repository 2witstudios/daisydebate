import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { rounds } from './schema/rounds';
import { usageReservations } from './schema/usage-reservations';

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
