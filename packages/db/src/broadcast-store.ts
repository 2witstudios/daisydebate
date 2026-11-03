import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { eq } from 'drizzle-orm';
import type { BroadcastReleasePolicy } from '@daisy/protocol';
import {
  claimBroadcastReconcile,
  completeBroadcast,
  discoverUnopenedBroadcastRounds,
  holdBroadcastReconcile,
  listOpenBroadcasts,
  openBroadcast,
  readConversationHeld,
  readBroadcastEgress,
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
    readonly feedKey: string;
    readonly releasePolicy: BroadcastReleasePolicy;
  }) => openBroadcast(database, input),
  listOpen: (limit: number, after: string | null = null) =>
    listOpenBroadcasts(database, limit, after),
  readEgress: (id: string) => readBroadcastEgress(database, id),
  conversationHeld: (roundId: string) =>
    readConversationHeld(database, { roundId }),
  claimReconcile: (input: Parameters<typeof claimBroadcastReconcile>[1]) =>
    claimBroadcastReconcile(database, input),
  async holdReconcile(input: Parameters<typeof holdBroadcastReconcile>[1]) {
    await holdBroadcastReconcile(database, input);
  },
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
      .leftJoin(
        mediaParticipants,
        eq(mediaParticipants.roundParticipantId, roundParticipants.id),
      )
      .where(eq(roundParticipants.roundId, broadcast.roundId));
    const launched = await launchedRoundRows(database, broadcast.roundId);
    const seen = new Map(launched.participants.map((p) => [p.id, p]));
    return {
      capture: broadcast,
      round,
      roomName: await readBroadcastRoom(database, broadcast.roundId),
      seats: seats.flatMap((seat) => {
        const person = seen.get(seat.participantId);
        return person === undefined
          ? []
          : [{ ...seat, label: person.label, kind: person.kind }];
      }),
    };
  },
  /** What says whether a Round expects a Broadcast, before its row exists. */
  async readCapturePlan(roundId: string) {
    const [row] = await database
      .select({
        competitionType: rounds.competitionType,
        capture: rounds.capture,
      })
      .from(rounds)
      .where(eq(rounds.id, roundId));
    return row ?? null;
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
  recordEgressStarted: (input: Parameters<typeof recordEgressStarted>[1]) =>
    recordEgressStarted(database, input),
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
