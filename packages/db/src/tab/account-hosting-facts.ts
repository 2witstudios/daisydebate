import type { TournamentHostingGrant } from '@daisy/protocol';
import { readDatabaseTime } from '../database-clock';
import { readEntitlementGrants } from '../entitlement-grants';
import type { TabTransaction } from './tab-transaction';

export type AccountHostingFacts = {
  readonly checkedAt: string;
  readonly grants: readonly TournamentHostingGrant[];
};

/** Caller holds the canonical account and all parent locks; no unrelated connection or wall clock. */
export const loadAccountHostingFacts = async (
  tx: TabTransaction,
  userId: string,
): Promise<AccountHostingFacts> => {
  const grants = await readEntitlementGrants(tx, userId);
  return {
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
    grants: grants.filter(
      (grant): grant is TournamentHostingGrant =>
        grant.entitlement === 'tournament_hosting',
    ),
  };
};
