import { participantAccess } from '@daisy/auth/authorization';
import type { DrawWrite, LoadedDrawCommand } from '@daisy/db/tab';

/** The closed-minors cast rule, using each person's canonical fenced account. */
export const drawEligibleActors = (
  accounts: LoadedDrawCommand['accounts'],
): ReadonlySet<string> =>
  new Set(
    accounts
      .filter(
        ({ account }) =>
          account?.member &&
          !account.erased &&
          participantAccess(account) &&
          account.ageBand === 'adult' &&
          account.boundary === null,
      )
      .map((person) => person.actorId),
  );

/** Only additions admit people. Removing a draft never admits its former cast. */
export const drawAdmissionsAllowed = (
  loaded: LoadedDrawCommand,
  writes: readonly DrawWrite[],
): boolean => {
  const eligible = drawEligibleActors(loaded.accounts);
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
