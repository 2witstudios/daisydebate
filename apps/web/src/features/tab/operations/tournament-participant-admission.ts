import { participantAccess } from '@daisy/auth/authorization';
import type { TabAccount } from '@daisy/db/tab';

/** The closed-minors cast rule, using each person's canonical fenced account. */
export const eligibleTournamentActors = (
  accounts: readonly {
    readonly actorId: string;
    readonly account: TabAccount | null;
  }[],
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
