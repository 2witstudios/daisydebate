import { participantAccess } from '@daisy/auth/authorization';
import type { TabAccount } from '@daisy/db/tab';

/** Draws use accepted entries and recheck each entrant’s fenced account. */
export const eligibleTournamentActors = (
  accounts: readonly {
    readonly actorId: string;
    readonly account: TabAccount | null;
  }[],
  role: 'debater' | 'judge',
): ReadonlySet<string> =>
  new Set(
    accounts
      .filter(
        ({ account }) =>
          account?.member &&
          !account.erased &&
          participantAccess(account) &&
          (role === 'debater' || account.ageBand === 'adult'),
      )
      .map((person) => person.actorId),
  );
