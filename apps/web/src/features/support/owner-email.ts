import type { SupportMessageNotice } from '@daisy/db/stores/support';
import { renderEmailLayout } from '../mail/layout';
import { supportTopicLabels } from './labels';

type StoredMessage = Extract<
  SupportMessageNotice,
  { kind: 'message' }
>['message'];

/** The message as the person wrote it: each line its own paragraph. */
const messageParagraphs = (message: string): readonly string[] =>
  message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

/**
 * The owner's email for one support message (SUPP-1): everything the form
 * asked and who sent it, so the owner can reply without opening anything
 * else. Its one link starts a reply to the sender.
 */
export function renderSupportMessageEmail(message: StoredMessage) {
  const topic = supportTopicLabels[message.topic];
  const lines = [
    `Topic: ${topic}`,
    ...(message.about ? [`About: ${message.about}`] : []),
    message.memberUsername === null
      ? 'Sent signed out'
      : `Member: @${message.memberUsername}`,
    `Reply to: ${message.replyEmail}`,
    `Received: ${message.receivedAt}`,
  ];
  return renderEmailLayout({
    subject: `Support: ${topic}`,
    preheader: `A support message about ${topic.toLowerCase()}.`,
    eyebrow: 'Support message',
    headline: topic,
    paragraphs: [
      ...lines,
      'Their message:',
      ...messageParagraphs(message.message),
    ],
    linkLabel: 'Reply',
    url: `mailto:${message.replyEmail}?subject=${encodeURIComponent(`Re: your Daisy support message (${topic})`)}`,
    footerNote:
      'You get this email because this address takes Daisy Debate support messages.',
  });
}
