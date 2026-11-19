import { and, eq } from 'drizzle-orm';
import { rooms } from '../schema/rooms';
import { rounds } from '../schema/rounds';
import { fixtures } from '../schema/fixtures';
import { results } from '../schema/results';
import { isRoundRunning } from '@daisy/protocol';
import type { Tx } from '../tx';
export const loadLobbyActivity = async (tx: Tx, lobbyId: string | null) => {
  if (lobbyId === null)
    return {
      liveRoundCount: 0,
      unresultedFixtureCount: 0,
      unstartedEventRoomIds: [],
    };
  const roundRows = await tx
    .select({ status: rounds.status })
    .from(rounds)
    .innerJoin(rooms, eq(rooms.id, rounds.roomId))
    .where(eq(rooms.lobbyId, lobbyId));
  const fixtureRows = await tx
    .select({ id: fixtures.id, resultId: results.id })
    .from(fixtures)
    .leftJoin(results, eq(results.fixtureId, fixtures.id))
    .where(
      and(eq(fixtures.lobbyId, lobbyId), eq(fixtures.status, 'published')),
    );
  return {
    liveRoundCount: roundRows.filter((row) => isRoundRunning(row.status))
      .length,
    unresultedFixtureCount: fixtureRows.filter((row) => row.resultId === null)
      .length,
    unstartedEventRoomIds: [],
  };
};
