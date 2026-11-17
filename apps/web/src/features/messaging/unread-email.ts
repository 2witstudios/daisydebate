import type { Database, MessagingUnreadEmailDelivery } from '@daisy/db';
import { renderEmailLayout } from '../mail/layout';
import { knownDeliveryRejection } from '../mail/resend-sender';
import {
  MAIL_LEASE_MS,
  MAIL_MAX_ATTEMPTS,
  MAIL_QUEUE_BATCH,
  retryOrFail as backOff,
} from '../mail/retry-policy';
import type { EmailMessage } from '../mail/types';
import { DIGEST_ONLINE_POSTPONE_MS } from '../notifications/email/delivery';
import {
  oneClickUnsubscribeUrl,
  unsubscribeUrl,
} from '../notifications/email/unsubscribe-token';

type Store = Pick<
  Database,
  | 'claimMessagingUnreadEmails'
  | 'readMessagingUnreadEmailDelivery'
  | 'settleMessagingUnreadEmail'
  | 'postponeMessagingUnreadEmail'
>;
type Claim = Awaited<ReturnType<Store['claimMessagingUnreadEmails']>>[number];
type Outcome = Parameters<Store['settleMessagingUnreadEmail']>[0]['outcome'];
type Sendable = Extract<MessagingUnreadEmailDelivery, { kind: 'send' }>;

const FOOTER_NOTE =
  'You get this email because of your Daisy Debate account. Daisy Debate never asks for a password by email.';

/**
 * Messaging's unread-messages email (ADR 0143): how many conversations wait,
 * and nothing about who wrote or what. Its one link opens Messages.
 */
export function renderUnreadMessagesEmail(input: {
  readonly delivery: Sendable;
  readonly appUrl: string;
  readonly unsubscribeUrl: string;
}) {
  const many = input.delivery.conversations > 1;
  const headline = many
    ? `${input.delivery.conversations} conversations have messages for you.`
    : 'A conversation has a message for you.';
  return renderEmailLayout({
    subject: `${headline} · Daisy`,
    preheader: 'Open Messages on Daisy to read them.',
    eyebrow: 'Messages',
    headline,
    paragraphs: [
      many
        ? 'They are waiting in your Daisy Messages, unread.'
        : 'It is waiting in your Daisy Messages, unread.',
    ],
    linkLabel: 'Open Messages',
    url: new URL('/messages', input.appUrl).toString(),
    footerNote: FOOTER_NOTE,
    unsubscribe: {
      label: 'Stop notification emails',
      url: input.unsubscribeUrl,
    },
  });
}

type Decision =
  | { readonly kind: 'settle'; readonly outcome: Outcome }
  | { readonly kind: 'postpone'; readonly until: string };

/**
 * Sends the unread-messages emails that are due (ADR 0143), as the
 * notification digest does: re-read at send time, waited while the member
 * is in Daisy, sent under the job's own idempotency key with the one-click
 * unsubscribe that stops notification email, and settled.
 */
export function createUnreadMessagesEmailDelivery(input: {
  readonly store: Store;
  readonly deliver: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  /** Whether the member is in Daisy now; unknown should be false. */
  readonly isOnline: (actorId: string) => Promise<boolean>;
  readonly appUrl: string;
  readonly unsubscribeSubkey: string;
  readonly nextToken: () => string;
  readonly now: () => string;
  readonly failed: (error: unknown) => void;
}) {
  const retryOrFail = (
    claim: Claim,
    errorCode: 'delivery' | 'delivery-unknown' = 'delivery',
  ): Outcome => backOff(claim.attempts, input.now(), errorCode);
  const decide = async (claim: Claim): Promise<Decision> => {
    const delivery = await input.store.readMessagingUnreadEmailDelivery(
      claim.id,
    );
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
    const rendered = renderUnreadMessagesEmail({
      delivery,
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
    async run(limit: number): Promise<number> {
      const claims = await input.store.claimMessagingUnreadEmails({
        limit: Math.min(limit, MAIL_QUEUE_BATCH),
        leaseMs: MAIL_LEASE_MS,
        maxAttempts: MAIL_MAX_ATTEMPTS,
        nextToken: input.nextToken,
      });
      let handled = 0;
      for (const claim of claims) {
        const decision = await decide(claim).catch(
          (error: unknown): Decision => {
            input.failed(error);
            return { kind: 'settle', outcome: retryOrFail(claim) };
          },
        );
        const held = { id: claim.id, token: claim.token };
        if (
          decision.kind === 'postpone'
            ? await input.store.postponeMessagingUnreadEmail({
                ...held,
                until: decision.until,
              })
            : await input.store.settleMessagingUnreadEmail({
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
