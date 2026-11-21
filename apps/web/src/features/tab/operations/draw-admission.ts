import { eligibleTournamentActors } from './tournament-participant-admission';
import type { DrawWrite, LoadedDrawCommand } from '@daisy/db/tab';

/** Only additions admit people. Removing a draft never admits its former cast. */
export const drawAdmissionsAllowed = async (
  loaded: LoadedDrawCommand,
  writes: readonly DrawWrite[],
  now: string,
): Promise<boolean> => {
  const debaters = eligibleTournamentActors(loaded.accounts, 'debater');
  const judges = eligibleTournamentActors(loaded.accounts, 'judge');
  const judgeEligible = (tournamentJudgeId: string) => {
    const judge = loaded.judges.find((row) => row.id === tournamentJudgeId);
    return judge !== undefined && judges.has(judge.actorId);
  };
  const entryActors = (entryId: string) =>
    loaded.members
      .filter((member) => member.entryId === entryId)
      .map(({ actorId }) => actorId);
  const publishedActors = new Set<string>();
  const allowed = writes.every((write) => {
    if (
      write.table === 'fixtures' &&
      write.op === 'update' &&
      'status' in write.set &&
      write.set.status === 'published'
    ) {
      const fixtureId = write.where.id;
      for (const entry of loaded.fixtureEntries.filter(
        (row) => row.fixtureId === fixtureId,
      ))
        for (const actorId of entryActors(entry.entryId))
          publishedActors.add(actorId);
      return loaded.fixtureJudges
        .filter((judge) => judge.fixtureId === fixtureId)
        .every(({ tournamentJudgeId }) => judgeEligible(tournamentJudgeId));
    }

    if (write.op !== 'insert') return true;
    if (write.table === 'room_participants')
      return debaters.has(write.row.actorId);
    if (write.table === 'fixture_judges')
      return judgeEligible(write.row.tournamentJudgeId);
    if (write.table === 'fixture_entries') {
      const members = entryActors(write.row.entryId);
      return (
        members.length > 0 && members.every((actorId) => debaters.has(actorId))
      );
    }
    return true;
  });
  return (
    allowed &&
    [...publishedActors].every((actorId) => debaters.has(actorId)) &&
    (await loaded.debatersAllowed([...publishedActors], now))
  );
};
