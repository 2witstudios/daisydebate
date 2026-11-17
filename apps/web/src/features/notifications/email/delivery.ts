import type { Database } from '@daisy/db';
import type { EmailMessage } from '../../mail/types';
import { createAwayMailDelivery } from './away-mail';
import { renderNotificationDigest } from './templates';

type Store = Pick<
  Database,
  | 'claimNotificationDigests'
  | 'readNotificationDigestDelivery'
  | 'settleNotificationDigest'
  | 'postponeNotificationDigest'
>;

/**
 * Sends the notification digests that are due (ADR 0144), through the one
 * away-mail loop: each lists the inbox's own words for what is still unread,
 * standing and wanted.
 */
export function createNotificationDigestDelivery(input: {
  readonly store: Store;
  readonly deliver: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  /** Whether the member is in Daisy now; unknown should be false. */
  readonly isOnline: (actorId: string) => Promise<boolean>;
  readonly appUrl: string;
  readonly unsubscribeSubkey: string;
  readonly nextToken: () => string;
  readonly now: () => string;
  /** A job that could not be decided: logged by code, raw only to the reporter. */
  readonly failed: (error: unknown) => void;
}) {
  const { store, ...edges } = input;
  return createAwayMailDelivery({
    ...edges,
    claim: (claim) => store.claimNotificationDigests(claim),
    read: (id) => store.readNotificationDigestDelivery(id),
    render: (read, unsubscribeUrl) =>
      renderNotificationDigest({
        items: read.items,
        appUrl: input.appUrl,
        unsubscribeUrl,
      }),
    settle: (held) => store.settleNotificationDigest(held),
    postpone: (held) => store.postponeNotificationDigest(held),
  });
}
