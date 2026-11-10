import type { Database } from '@daisy/db';
import { knownDeliveryRejection } from '../../mail/resend-sender';
import {
  MAIL_LEASE_MS,
  MAIL_QUEUE_BATCH,
  retryOrFail as backOff,
} from '../../mail/retry-policy';
import type { EmailMessage } from '../../mail/types';
import { renderNotificationEmail } from './templates';
import { oneClickUnsubscribeUrl, unsubscribeUrl } from './unsubscribe-token';

type Store = Pick<
  Database,
  | 'claimNotificationEmails'
  | 'readNotificationEmailDelivery'
  | 'settleNotificationEmail'
>;
type Claim = Awaited<ReturnType<Store['claimNotificationEmails']>>[number];
type Outcome = Parameters<Store['settleNotificationEmail']>[0]['outcome'];

/**
 * Sends the notification emails that are due (ADR 0124). Each claim reads
 * what the email should say now, renders it with its one-click unsubscribe,
 * sends it under the job's own idempotency key and settles the outcome. A
 * job whose subject ended, whose member turned the kind off, is gone, or
 * had the hour's emails is cancelled instead; a failed send retries with
 * backoff until it fails for good. The send happens outside any
 * transaction; a crash before settling only delays it, and the next claim
 * sends again under the same key.
 */
export function createNotificationEmailDelivery(input: {
  readonly store: Store;
  readonly deliver: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  readonly appUrl: string;
  readonly unsubscribeSubkey: string;
  readonly nextToken: () => string;
  readonly now: () => string;
  /** A job that could not be decided: logged by code, raw only to the reporter. */
  readonly failed: (error: unknown) => void;
}) {
  const retryOrFail = (
    claim: Claim,
    errorCode: 'delivery' | 'delivery-unknown' = 'delivery',
  ): Outcome => backOff(claim.attempts, input.now(), errorCode);
  const decide = async (claim: Claim): Promise<Outcome> => {
    const delivery = await input.store.readNotificationEmailDelivery(claim.id);
    if (delivery.kind === 'cancel')
      return { kind: 'cancelled', errorCode: delivery.errorCode };
    const optOut = { userId: delivery.userId, kind: delivery.kind };
    const link = unsubscribeUrl(input.appUrl, input.unsubscribeSubkey, optOut);
    const oneClick = oneClickUnsubscribeUrl(
      input.appUrl,
      input.unsubscribeSubkey,
      optOut,
    );
    const rendered = renderNotificationEmail({
      delivery,
      appUrl: input.appUrl,
      unsubscribeUrl: link,
    });
    try {
      const sent = await input.deliver({
        ...rendered,
        to: delivery.to,
        idempotencyKey: claim.id,
        headers: {
          'List-Unsubscribe': `<${oneClick}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      return sent === 'sent'
        ? { kind: 'sent' }
        : { kind: 'cancelled', errorCode: 'suppressed' };
    } catch (error) {
      return retryOrFail(
        claim,
        knownDeliveryRejection(error) ? 'delivery' : 'delivery-unknown',
      );
    }
  };
  return {
    /** Sends up to `limit` due jobs one after another; resolves to how many it settled. */
    async run(limit: number): Promise<number> {
      const claims = await input.store.claimNotificationEmails({
        limit: Math.min(limit, MAIL_QUEUE_BATCH),
        leaseMs: MAIL_LEASE_MS,
        nextToken: input.nextToken,
      });
      let settled = 0;
      for (const claim of claims) {
        // One job whose read fails counts as a failed attempt; it never
        // aborts the rest of the batch (ISSUE-656).
        const outcome = await decide(claim).catch((error: unknown) => {
          input.failed(error);
          return retryOrFail(claim);
        });
        if (
          await input.store.settleNotificationEmail({
            id: claim.id,
            token: claim.token,
            outcome,
          })
        )
          settled += 1;
      }
      return settled;
    },
  };
}
