import { and, asc, eq, inArray } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { entries, entryMembers } from '../schema/entries';
import { tournamentJudges } from '../schema/tournament-judges';
import type { TabTransaction } from './tab-transaction';
export const namedTournamentPeople = async (
  tx: TabTransaction,
  lobbyId: string,
) => {
  const members = await tx
    .select({ actorId: entryMembers.actorId })
    .from(entryMembers)
    .innerJoin(entries, eq(entries.id, entryMembers.entryId))
    .where(and(eq(entries.lobbyId, lobbyId), eq(entries.status, 'accepted')));
  const judges = await tx
    .select({ actorId: tournamentJudges.actorId })
    .from(tournamentJudges)
    .where(
      and(
        eq(tournamentJudges.lobbyId, lobbyId),
        eq(tournamentJudges.status, 'accepted'),
      ),
    );
  const ids = [
    ...new Set([...members, ...judges].map((row) => row.actorId)),
  ].sort();
  return ids.length
    ? tx
        .select({ actorId: actors.id, userId: actors.userId })
        .from(actors)
        .where(inArray(actors.id, ids))
        .orderBy(asc(actors.id))
    : [];
};
