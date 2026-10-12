import {
  observationFactKey,
  assertObservationFactBudget,
} from './observation-fact-boundary';
import { asc, eq, inArray } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { rooms, roomParticipants } from './schema/rooms';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import {
  audienceParticipants,
  roomAudienceColumns,
  roundAudienceColumns,
} from './audience-facts';
import type {
  ObservationAuthorityContext,
  ObservationBinding,
} from './observation-contracts';

type Reader = Pick<BunSQLDatabase, 'select' | 'execute'>;
type Fact = ObservationAuthorityContext['resourceFact'];
export async function observationParentFacts(
  tx: Reader,
  bindings: readonly ObservationBinding[],
) {
  const facts = new Map<string, Fact>();
  const ids = (kind: string) => [
    ...new Set(
      bindings
        .filter((b) => b.resource.kind === kind)
        .map((b) => b.resource.id),
    ),
  ];
  const roomIds = ids('room');
  if (roomIds.length) {
    const rows = await tx
      .select(roomAudienceColumns)
      .from(rooms)
      .leftJoin(roomParticipants, eq(roomParticipants.roomId, rooms.id))
      .where(inArray(rooms.id, roomIds))
      .orderBy(asc(rooms.id), asc(roomParticipants.id))
      .limit(4097);
    assertObservationFactBudget(rows.length);
    for (const binding of bindings.filter((b) => b.resource.kind === 'room')) {
      const cast = rows.filter((row) => row.roomId === binding.resource.id);
      const row = cast[0];
      if (!row) continue;
      facts.set(observationFactKey(binding), {
        kind: 'room',
        roomId: row.roomId,
        hostActorId: row.hostActorId,
        visibility: row.visibility,
        status: row.status,
        revision: row.revision,
        participants: audienceParticipants(cast),
      });
    }
  }
  const roundIds = ids('round');
  if (roundIds.length) {
    const rows = await tx
      .select(roundAudienceColumns)
      .from(rounds)
      .leftJoin(roundParticipants, eq(roundParticipants.roundId, rounds.id))
      .where(inArray(rounds.id, roundIds))
      .orderBy(asc(rounds.id), asc(roundParticipants.id))
      .limit(4097);
    assertObservationFactBudget(rows.length);
    for (const binding of bindings.filter((b) => b.resource.kind === 'round')) {
      const cast = rows.filter((row) => row.roundId === binding.resource.id);
      const row = cast[0];
      if (!row || row.visibility === null) continue;
      facts.set(observationFactKey(binding), {
        kind: 'round',
        roundId: row.roundId,
        createdByActorId: row.createdByActorId,
        visibility: row.visibility,
        status: row.status,
        revision: row.revision,
        participants: audienceParticipants(cast),
      });
    }
  }
  return facts;
}
