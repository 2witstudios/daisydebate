import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { eq } from 'drizzle-orm';
import type { BroadcastReleasePolicy } from '@daisy/protocol';
import {
  completeBroadcast,
  discoverUnopenedRankedRounds,
  listOpenBroadcasts,
  openBroadcast,
  readBroadcastRoom,
  recordEgressStarted,
  recordFinalMediaEnd,
  recordObserverRestored,
  recordObserverRevoked,
  recordRevocationFailed,
} from './broadcast-operations';
import { hydrateRoundRows } from './round-hydration';
import { rounds } from './schema/rounds';

/** The Broadcast control plane's reads and writes. No Round lock anywhere (ADR 0099). */
export const createBroadcastStore = (database: BunSQLDatabase) => ({
  discoverUnopenedRanked: (limit: number) =>
    discoverUnopenedRankedRounds(database, limit),
  open: (input: {
    readonly id: string;
    readonly roundId: string;
    readonly releasePolicy: BroadcastReleasePolicy;
  }) => openBroadcast(database, input),
  listOpen: (limit: number) => listOpenBroadcasts(database, limit),
  async readRound(roundId: string) {
    const round = await hydrateRoundRows(database, roundId);
    if (!round) return null;
    const [row] = await database
      .select({ endedAt: rounds.completedAt })
      .from(rounds)
      .where(eq(rounds.id, roundId));
    return {
      round,
      endedAt: row?.endedAt ?? null,
      roomName: await readBroadcastRoom(database, roundId),
    };
  },
  async recordEgressStarted(input: Parameters<typeof recordEgressStarted>[1]) {
    await recordEgressStarted(database, input);
  },
  async recordObserverRevoked(
    input: Parameters<typeof recordObserverRevoked>[1],
  ) {
    await recordObserverRevoked(database, input);
  },
  async recordRevocationFailed(id: string) {
    await recordRevocationFailed(database, id);
  },
  async recordObserverRestored(id: string) {
    await recordObserverRestored(database, id);
  },
  async recordFinalMediaEnd(input: Parameters<typeof recordFinalMediaEnd>[1]) {
    await recordFinalMediaEnd(database, input);
  },
  async complete(input: Parameters<typeof completeBroadcast>[1]) {
    await completeBroadcast(database, input);
  },
});
