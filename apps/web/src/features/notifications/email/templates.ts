import type { NotificationEmailDelivery } from '@daisy/db';
import { renderEmailLayout } from '../../mail/layout';
import { challengeWhat, invitedTo } from '../notification-words';

type Sendable = Exclude<NotificationEmailDelivery, { kind: 'cancel' }>;

const FOOTER_NOTE =
  'You get this email because of your Daisy Debate account. Daisy Debate never asks for a password by email.';

/**
 * A notification's email (ADR 0124), through the shared Daisy layout. It
 * names only public usernames and the Room's title, links to where the
 * member acts, and carries a link that turns off only this kind of email.
 */
export function renderNotificationEmail(input: {
  readonly delivery: Sendable;
  readonly appUrl: string;
  readonly unsubscribeUrl: string;
}) {
  const { delivery } = input;
  const unsubscribe = {
    label:
      delivery.kind === 'room_invitation'
        ? 'Stop emails about room invitations'
        : 'Stop emails about challenges',
    url: input.unsubscribeUrl,
  };
  if (delivery.kind === 'room_invitation') {
    const what = invitedTo(delivery.seat);
    return renderEmailLayout({
      subject: `@${delivery.host} invited you ${what} on Daisy`,
      preheader: `“${delivery.roomTitle}” is holding a ${delivery.seat} seat for you.`,
      eyebrow: 'Room invitation',
      headline: `@${delivery.host} invited you ${what}.`,
      paragraphs: [
        `The room “${delivery.roomTitle}” is holding a ${delivery.seat} seat for you for 24 hours, or until the round starts.`,
        delivery.seat === 'judge'
          ? 'Open the room and take the judge seat. Nobody else can take it while you are invited.'
          : 'Open the room and take a debater seat. The host arranges the sides.',
      ],
      linkLabel: 'Open the room',
      url: new URL(`/rooms/${delivery.roomId}`, input.appUrl).toString(),
      footerNote: FOOTER_NOTE,
      unsubscribe,
    });
  }
  const what = challengeWhat(delivery.mode, delivery.format);
  return renderEmailLayout({
    subject: `@${delivery.challenger} challenged you on Daisy`,
    preheader: `${what}. Challenges stay open for two minutes.`,
    eyebrow: 'Challenge',
    headline: `@${delivery.challenger} challenged you.`,
    paragraphs: [
      `They want ${what}. A challenge stays open for two minutes.`,
      'If it has ended by the time you arrive, challenge them back from Friends.',
    ],
    linkLabel: 'Open Friends',
    url: new URL('/friends', input.appUrl).toString(),
    footerNote: FOOTER_NOTE,
    unsubscribe,
  });
}
