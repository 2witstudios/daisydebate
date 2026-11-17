import { DIGEST_ONLINE_POSTPONE_MS, type Database } from '@daisy/db';
import { knownDeliveryRejection } from '../../mail/resend-sender';
import {
  MAIL_LEASE_MS,
  MAIL_MAX_ATTEMPTS,
  MAIL_QUEUE_BATCH,
  retryOrFail as backOff,
} from '../../mail/retry-policy';
import type { EmailMessage } from '../../mail/types';
import { renderNotificationDigest } from './templates';
import { oneClickUnsubscribeUrl, unsubscribeUrl } from './unsubscribe-token';

type Store = Pick<
  Database,
  | 'claimNotificationDigests'
  | 'readNotificationDigestDelivery'
  | 'settleNotificationDigest'
  | 'postponeNotificationDigest'
>;
type Claim = Awaited<ReturnType<Store['claimNotificationDigests']>>[number];
type Outcome = Parameters<Store['settleNotificationDigest']>[0]['outcome'];

/** What a claimed digest comes to: settled, or put back to wait. */
type Decision =
  | { readonly kind: 'settle'; readonly outcome: Outcome }
  | { readonly kind: 'postpone'; readonly until: string };

/**
 * Sends the notification digests that are due (ADR 0143). Each claim reads
 * what the digest should say now; one whose member is in Daisy waits again,
 * since they see it there. Otherwise it is rendered with its one-click
 * unsubscribe, sent under the job's own idempotency key and settled. A
 * digest left with nothing to say, or whose member is gone, is cancelled; a
 * failed send retries with backoff until it fails for good. The send happens
 * outside any transaction; a crash before settling only delays it, and the
 * next claim sends again under the same key.
 */
export function createNotificationDigestDelivery(input: {
  readonly store: Store;
  readonly deliver: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  /**
   * Whether the member is in Daisy now. An unknown answer (presence is down)
   * should be false: a late email beats one that never goes.
   */
  readonly isOnline: (actorId: string) => Promise<boolean>;
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
  const decide = async (claim: Claim): Promise<Decision> => {
    const delivery = await input.store.readNotificationDigestDelivery(claim.id);
    if (delivery.kind === 'cancel')
      return {
        kind: 'settle',
        outcome: { kind: 'cancelled', errorCode: delivery.errorCode },
      };
    if (await input.isOnline(delivery.actorId))
      return {
        kind: 'postpone',
        until: new Date(
          Date.parse(input.now()) + DIGEST_ONLINE_POSTPONE_MS,
        ).toISOString(),
      };
    const optOut = { userId: delivery.userId };
    const rendered = renderNotificationDigest({
      items: delivery.items,
      appUrl: input.appUrl,
      unsubscribeUrl: unsubscribeUrl(
        input.appUrl,
        input.unsubscribeSubkey,
        optOut,
      ),
    });
    const oneClick = oneClickUnsubscribeUrl(
      input.appUrl,
      input.unsubscribeSubkey,
      optOut,
    );
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
      return {
        kind: 'settle',
        outcome:
          sent === 'sent'
            ? { kind: 'sent' }
            : { kind: 'cancelled', errorCode: 'suppressed' },
      };
    } catch (error) {
      return {
        kind: 'settle',
        outcome: retryOrFail(
          claim,
          knownDeliveryRejection(error) ? 'delivery' : 'delivery-unknown',
        ),
      };
    }
  };
  return {
    /** Decides up to `limit` due digests one after another; resolves to how many it settled or put back. */
    async run(limit: number): Promise<number> {
      const claims = await input.store.claimNotificationDigests({
        limit: Math.min(limit, MAIL_QUEUE_BATCH),
        leaseMs: MAIL_LEASE_MS,
        maxAttempts: MAIL_MAX_ATTEMPTS,
        nextToken: input.nextToken,
      });
      let handled = 0;
      for (const claim of claims) {
        // One job whose read fails counts as a failed attempt; it never
        // aborts the rest of the batch (ISSUE-656).
        const decision = await decide(claim).catch(
          (error: unknown): Decision => {
            input.failed(error);
            return { kind: 'settle', outcome: retryOrFail(claim) };
          },
        );
        const held = { id: claim.id, token: claim.token };
        if (
          decision.kind === 'postpone'
            ? await input.store.postponeNotificationDigest({
                ...held,
                until: decision.until,
              })
            : await input.store.settleNotificationDigest({
                ...held,
                outcome: decision.outcome,
              })
        )
          handled += 1;
      }
      return handled;
    },
  };
}
