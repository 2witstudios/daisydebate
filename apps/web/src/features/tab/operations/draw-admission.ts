import { eligibleTournamentActors } from './tournament-participant-admission';
import type { DrawWrite, LoadedDrawCommand } from '@daisy/db/tab';

/** Only additions admit people. Removing a draft never admits its former cast. */
export const drawAdmissionsAllowed = (
  loaded: LoadedDrawCommand,
  writes: readonly DrawWrite[],
): boolean => {
  const debaters = eligibleTournamentActors(loaded.accounts, 'debater');
  const judges = eligibleTournamentActors(loaded.accounts, 'judge');
  const judgeEligible = (tournamentJudgeId: string) => {
    const judge = loaded.judges.find((row) => row.id === tournamentJudgeId);
    return judge !== undefined && judges.has(judge.actorId);
  };
  return writes.every((write) => {
    if (
      write.table === 'fixtures' &&
      write.op === 'update' &&
      'status' in write.set &&
      write.set.status === 'published'
    )
      return loaded.fixtureJudges
        .filter((judge) => judge.fixtureId === write.where.id)
        .every(({ tournamentJudgeId }) => judgeEligible(tournamentJudgeId));

    if (write.op !== 'insert') return true;
    if (write.table === 'room_participants')
      return debaters.has(write.row.actorId);
    if (write.table === 'fixture_judges')
      return judgeEligible(write.row.tournamentJudgeId);
    if (write.table === 'fixture_entries') {
      const members = loaded.members.filter(
        (member) => member.entryId === write.row.entryId,
      );
      return (
        members.length > 0 &&
        members.every((member) => debaters.has(member.actorId))
      );
    }
    return true;
  });
};
