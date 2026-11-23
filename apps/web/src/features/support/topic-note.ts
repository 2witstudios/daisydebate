import type { SupportTopic } from '@daisy/protocol/support-message';

/**
 * What the form says once a topic is chosen (SUPP-1). A safety concern
 * about a person, message or round belongs in the in-product Report, which
 * reaches moderation with what it is about; a copy or deletion of one's
 * data is in Settings. Neither stops the message being sent.
 */
export type SupportTopicNote =
  | { readonly kind: 'none' }
  | { readonly kind: 'report'; readonly text: string }
  | {
      readonly kind: 'settings';
      readonly text: string;
      readonly link: { readonly label: string; readonly href: string };
    };

export function supportTopicNote(topic: SupportTopic): SupportTopicNote {
  switch (topic) {
    case 'safety':
      return {
        kind: 'report',
        text: 'To report a person, message or round, use Report on it. It goes straight to moderation. You can still send this.',
      };
    case 'account':
      return {
        kind: 'settings',
        text: 'You can download or delete your data yourself in',
        link: { label: 'Settings', href: '/settings#privacy' },
      };
    case 'problem':
    case 'question':
    case 'feedback':
      return { kind: 'none' };
  }
}
