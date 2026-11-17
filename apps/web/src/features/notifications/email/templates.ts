import type { InboxRow } from '@daisy/db';
import { renderEmailLayout } from '../../mail/layout';
import { notificationWords } from '../notification-words';

const FOOTER_NOTE =
  'You get this email because of your Daisy Debate account. Daisy Debate never asks for a password by email.';

/**
 * A member's batched notification email (ADR 0143), through the shared Daisy
 * layout. Each line is the same words the inbox shows, so it names only
 * public usernames and carries no outcome; its one link opens the inbox,
 * where each line leads on. The footer link stops notification email.
 */
export function renderNotificationDigest(input: {
  /** Newest first; at least one. */
  readonly items: readonly InboxRow[];
  readonly appUrl: string;
  readonly unsubscribeUrl: string;
}) {
  const lines = input.items.map((item) => notificationWords(item).text);
  const one = lines.length === 1;
  const headline = one
    ? lines[0]!
    : `${lines.length} things are waiting for you.`;
  return renderEmailLayout({
    subject: one ? `${lines[0]!} · Daisy` : `${headline} · Daisy`,
    preheader: one ? 'Open Daisy to answer.' : lines.slice(0, 2).join(' '),
    eyebrow: 'While you were away',
    headline,
    paragraphs: one
      ? ['It is waiting in your Daisy inbox.']
      : [...lines, 'Each one is waiting in your Daisy inbox.'],
    linkLabel: 'Open your inbox',
    url: new URL('/notifications', input.appUrl).toString(),
    footerNote: FOOTER_NOTE,
    unsubscribe: {
      label: 'Stop notification emails',
      url: input.unsubscribeUrl,
    },
  });
}
