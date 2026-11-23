import type { SupportStore } from '@daisy/db/stores/support';
import type { EmailMessage } from '../mail/types';
import { createOwnerNotices } from '../mail/owner-notices';
import { renderSupportMessageEmail } from './owner-email';

type Store = Pick<
  SupportStore,
  | 'claimSupportMessageNotices'
  | 'readSupportMessageNotice'
  | 'settleSupportMessageNotice'
>;

/**
 * Tells the owner about each support message that is due (SUPP-1), through
 * the owner-notice queue: each claim reads the message fresh and renders
 * it; a message gone before its turn (retention or erasure) is cancelled.
 */
export function createSupportMessageNotices(input: {
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
    purpose: 'support',
    suppressedMessage: 'Support owner address is suppressed',
    claim: store.claimSupportMessageNotices,
    compose: async (id) => {
      const notice = await store.readSupportMessageNotice(id);
      return notice.kind === 'gone'
        ? null
        : renderSupportMessageEmail(notice.message);
    },
    settle: store.settleSupportMessageNotice,
  });
}
