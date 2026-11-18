import type { LeagueRequestNotice } from '@daisy/db';
import { renderEmailLayout } from '../mail/layout';
import {
  divisionsLabels,
  schoolCountLabels,
  seasonCountLabels,
  styleLabels,
} from './labels';

type StoredRequest = Extract<
  LeagueRequestNotice,
  { kind: 'request' }
>['request'];

/**
 * The owner's email for one League request (PYL-17): everything the form
 * asked, so the owner can reply without opening anything else. Its one link
 * starts a reply to the contact.
 */
export function renderLeagueRequestEmail(request: StoredRequest) {
  const lines = [
    `League: ${request.leagueName}`,
    `Schools: ${schoolCountLabels[request.schools]}`,
    `Seasons a year: ${seasonCountLabels[request.seasons]}`,
    `Style: ${styleLabels[request.style]}`,
    `Divisions: ${divisionsLabels[request.divisions]}`,
    `Contact: ${request.contactName}, ${request.contactRole}`,
    `Email: ${request.contactEmail}`,
    ...(request.contactPhone ? [`Phone: ${request.contactPhone}`] : []),
    `Received: ${request.receivedAt}`,
  ];
  return renderEmailLayout({
    subject: `League request: ${request.leagueName}`,
    preheader: `${request.contactName} wants to run ${request.leagueName} on Daisy.`,
    eyebrow: 'League request',
    headline: request.leagueName,
    paragraphs: [
      ...lines,
      request.needs ? `What they need: ${request.needs}` : 'No notes given.',
      'They were told you reply within two working days.',
    ],
    linkLabel: `Reply to ${request.contactName}`,
    url: `mailto:${request.contactEmail}?subject=${encodeURIComponent(`Your Daisy league request: ${request.leagueName}`)}`,
    footerNote:
      'You get this email because this address takes Daisy Debate league requests.',
  });
}
