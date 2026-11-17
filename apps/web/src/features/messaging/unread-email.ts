import type { Database, MessagingUnreadEmailDelivery } from '@daisy/db';
import { renderEmailLayout } from '../mail/layout';
import type { EmailMessage } from '../mail/types';
import { createAwayMailDelivery } from '../notifications/email/away-mail';

type Store = Pick<
  Database,
  | 'claimMessagingUnreadEmails'
  | 'readMessagingUnreadEmailDelivery'
  | 'settleMessagingUnreadEmail'
  | 'postponeMessagingUnreadEmail'
>;
type Sendable = Extract<MessagingUnreadEmailDelivery, { kind: 'send' }>;

const FOOTER_NOTE =
  'You get this email because of your Daisy Debate account. Daisy Debate never asks for a password by email.';

/**
 * Messaging's unread-messages email (ADR 0144): how many conversations wait,
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

/**
 * Sends the unread-messages emails that are due (ADR 0144), through the one
 * away-mail loop the notification digest uses.
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
  const { store, ...edges } = input;
  return createAwayMailDelivery({
    ...edges,
    claim: (claim) => store.claimMessagingUnreadEmails(claim),
    read: (id) => store.readMessagingUnreadEmailDelivery(id),
    render: (delivery, unsubscribeUrl) =>
      renderUnreadMessagesEmail({
        delivery,
        appUrl: input.appUrl,
        unsubscribeUrl,
      }),
    settle: (held) => store.settleMessagingUnreadEmail(held),
    postpone: (held) => store.postponeMessagingUnreadEmail(held),
  });
}
