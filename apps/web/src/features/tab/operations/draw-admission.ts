import { eligibleTournamentActors } from './tournament-participant-admission';
import type { DrawWrite, LoadedDrawCommand } from '@daisy/db/tab';

/** Only additions admit people. Removing a draft never admits its former cast. */
export const drawAdmissionsAllowed = (
  loaded: LoadedDrawCommand,
  writes: readonly DrawWrite[],
): boolean => {
  const eligible = eligibleTournamentActors(loaded.accounts);
  return writes.every((write) => {
    if (write.op !== 'insert') return true;
    if (write.table === 'room_participants')
      return eligible.has(write.row.actorId);
    if (write.table === 'fixture_judges') {
      const judge = loaded.judges.find(
        (judge) => judge.id === write.row.tournamentJudgeId,
      );
      return judge !== undefined && eligible.has(judge.actorId);
    }
    if (write.table === 'fixture_entries') {
      const members = loaded.members.filter(
        (member) => member.entryId === write.row.entryId,
      );
      return (
        members.length > 0 &&
        members.every((member) => eligible.has(member.actorId))
      );
    }
    return true;
  });
};
