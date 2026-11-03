import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { eq } from 'drizzle-orm';
import type { BroadcastReleasePolicy } from '@daisy/protocol';
import {
  claimBroadcastReconcile,
  completeBroadcast,
  discoverUnopenedBroadcastRounds,
  listOpenBroadcasts,
  openBroadcast,
  readConversationHeld,
  readOfficialFeedFacts,
  readBroadcastRoom,
  recordEgressStarted,
  recordFinalMediaEnd,
  recordObserverRestored,
  recordObserverRevoked,
  recordRevocationFailed,
} from './broadcast-operations';
import { launchedRoundRows } from './room-read-operations';
import { hydrateRoundRows } from './round-hydration';
import { broadcasts } from './schema/broadcasts';
import { mediaParticipants } from './schema/media-sessions';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';

/** The Broadcast control plane's reads and writes. No Round lock anywhere (ADR 0099). */
export const createBroadcastStore = (database: BunSQLDatabase) => ({
  discoverUnopened: (limit: number) =>
    discoverUnopenedBroadcastRounds(database, limit),
  open: (input: {
    readonly id: string;
    readonly roundId: string;
    readonly releasePolicy: BroadcastReleasePolicy;
  }) => openBroadcast(database, input),
  listOpen: (limit: number) => listOpenBroadcasts(database, limit),
  conversationHeld: (roundId: string) =>
    readConversationHeld(database, { roundId }),
  claimReconcile: (input: Parameters<typeof claimBroadcastReconcile>[1]) =>
    claimBroadcastReconcile(database, input),
  officialFeedFacts: (roundId: string) =>
    readOfficialFeedFacts(database, { roundId }),
  /** Everything the stage burns in. Read-only, and it locks nothing. */
  async readStage(id: string) {
    const [broadcast] = await database
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.id, id));
    if (!broadcast) return null;
    const round = await hydrateRoundRows(database, broadcast.roundId);
    if (!round) return null;
    const seats = await database
      .select({
        participantId: roundParticipants.id,
        role: roundParticipants.role,
        identity: mediaParticipants.identity,
      })
      .from(roundParticipants)
      .innerJoin(
        mediaParticipants,
        eq(mediaParticipants.roundParticipantId, roundParticipants.id),
      )
      .where(eq(roundParticipants.roundId, broadcast.roundId));
    const launched = await launchedRoundRows(database, broadcast.roundId);
    const labels = new Map(launched.participants.map((p) => [p.id, p.label]));
    return {
      broadcast,
      round,
      roomName: await readBroadcastRoom(database, broadcast.roundId),
      seats: seats.flatMap((seat) => {
        const label = labels.get(seat.participantId);
        return label === undefined ? [] : [{ ...seat, label }];
      }),
    };
  },
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
