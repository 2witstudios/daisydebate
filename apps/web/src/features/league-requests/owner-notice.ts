import type { LeagueRequestsStore } from '@daisy/db/stores/league-requests';
import type { EmailMessage } from '../mail/types';
import { createOwnerNotices } from '../mail/owner-notices';
import { renderLeagueRequestEmail } from './owner-email';

type Store = Pick<
  LeagueRequestsStore,
  | 'claimLeagueRequestNotices'
  | 'readLeagueRequestNotice'
  | 'settleLeagueRequestNotice'
>;

/**
 * Tells the owner about each League request that is due (PYL-17), through
 * the owner-notice queue: each claim reads the request fresh and renders it;
 * a request gone before its turn (retention) is cancelled.
 */
export function createLeagueRequestNotices(input: {
  readonly store: Store;
  readonly deliver: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  readonly ownerAddress: string;
  readonly nextToken: () => string;
  readonly now: () => string;
  /** A notice that could not be decided and will be tried again: logged by code, raw only to the reporter. */
  readonly failed: (error: unknown) => void;
  /** A notice that failed for good: always reported, because nothing will try it again. */
  readonly gaveUp: (error: unknown) => void;
}) {
  const { store, ...delivery } = input;
  return createOwnerNotices({
    ...delivery,
    purpose: 'league-request',
    suppressedMessage: 'League request owner address is suppressed',
    claim: store.claimLeagueRequestNotices,
    compose: async (id) => {
      const notice = await store.readLeagueRequestNotice(id);
      return notice.kind === 'gone'
        ? null
        : renderLeagueRequestEmail(notice.request);
    },
    settle: store.settleLeagueRequestNotice,
  });
}
