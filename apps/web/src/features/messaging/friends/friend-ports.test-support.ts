import { fixedClock, sequentialId } from '@daisy/clock';
import { dec251MessagingValues } from '../beta-policy';

/** The clock, ledger ids and DEC-251 budgets friend operation tests share. */
export const friendTestPorts = (now: string) => ({
  clock: fixedClock(now),
  ids: sequentialId('friend-request'),
  limits: dec251MessagingValues.socialRequests,
});
