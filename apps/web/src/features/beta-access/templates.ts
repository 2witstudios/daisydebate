import { renderEmailLayout } from '../mail/layout';

/**
 * Beta access mail (ADR 0075), rendered through the shared Daisy mail
 * layout. Neither message carries an address; the approval names only the
 * member's own public username, the digest only counts.
 */
export type BetaEmailInput =
  | {
      readonly kind: 'beta-approved';
      readonly username: string;
      readonly url: string;
    }
  | {
      readonly kind: 'beta-requests';
      readonly newRequests: number;
      readonly waiting: number;
      readonly url: string;
    };

const FOOTER_NOTE =
  'You get this email because of your Daisy Debate account. Daisy Debate never asks for a password by email.';

const accounts = (count: number) =>
  `${count} ${count === 1 ? 'account' : 'accounts'}`;

export function renderBetaEmail(input: BetaEmailInput) {
  switch (input.kind) {
    case 'beta-approved':
      return renderEmailLayout({
        subject: "You're in: Daisy Debate beta",
        preheader: 'Your beta access is ready. Come debate.',
        eyebrow: 'Beta access',
        headline: `You're in, @${input.username}.`,
        paragraphs: [
          'Your place on the Daisy Debate beta list came up, and your account now has full access.',
          'Pick a format and find your first round.',
        ],
        linkLabel: 'Start debating',
        url: input.url,
        footerNote: FOOTER_NOTE,
      });
    case 'beta-requests':
      return renderEmailLayout({
        subject: `${accounts(input.newRequests)} joined the beta list`,
        preheader: `${accounts(input.waiting)} waiting for review.`,
        eyebrow: 'Beta requests',
        headline: `${accounts(input.newRequests)} joined the beta list.`,
        paragraphs: [
          `${accounts(input.waiting)} now ${input.waiting === 1 ? 'waits' : 'wait'} for review in total.`,
          'Open the admin app through fly proxy to approve them.',
        ],
        linkLabel: 'Review beta requests',
        url: input.url,
        footerNote: FOOTER_NOTE,
      });
  }
}
