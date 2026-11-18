import { renderEmailLayout } from '../mail/layout';

/**
 * The Club seat invitation (ADR 0148). It names the club and its manager,
 * never the invitee's address in the body; the link opens the invitation,
 * which only a signed-in account with this verified address can accept.
 */
export function renderClubSeatInvitation(input: {
  readonly clubName: string;
  readonly manager: string;
  readonly url: string;
  readonly expiresAt: string;
}) {
  const until = new Date(input.expiresAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return renderEmailLayout({
    subject: `${input.clubName} saved you a Premium seat on Daisy`,
    preheader: `${input.manager} invited you to a seat on ${input.clubName}'s Club plan.`,
    eyebrow: 'Club seat',
    headline: `A seat from ${input.clubName}.`,
    paragraphs: [
      `${input.manager} invited you to a seat on ${input.clubName}'s Club plan. The seat gives you Daisy Premium, paid by the club.`,
      `Sign in with the email that received this invitation to accept it. The invitation lasts until ${until}.`,
    ],
    linkLabel: 'Accept your seat',
    url: input.url,
    footerNote:
      'You received this because a club manager entered your email on Daisy Debate. Forwarding this message does not move the seat: only this address can accept it.',
  });
}

/** The invitation's page: it names the club and the invitation, no bearer secret. */
export const clubInvitationPath = (
  organizationId: string,
  invitationId: string,
) => `/clubs/invitations/${organizationId}.${invitationId}`;
