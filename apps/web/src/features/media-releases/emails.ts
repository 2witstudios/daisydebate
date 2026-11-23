import type { PreparedReleaseMail } from '@daisy/db/stores/media-releases';
import { renderEmailLayout } from '../mail/layout';
import { guardianRelationWords, releaseDate } from './release-words';

type Owed = Extract<PreparedReleaseMail, { kind: 'owed' }>;

/**
 * The parent's emails (ADR 0151, board "Parent email"). Each names the minor
 * by username only, carries one link, and never the minor's details beyond
 * that. A request or reminder also offers "Don't send me release requests".
 */
export function renderReleaseMail(
  mail: Owed,
  links: {
    readonly url: string;
    readonly stopUrl: string;
    readonly manageUrl: string;
  },
) {
  const minor =
    mail.minorUsername === null ? 'A Daisy member' : `@${mail.minorUsername}`;
  const until = releaseDate(mail.linkExpiresAt);
  switch (mail.mail) {
    case 'request':
    case 'reminder':
      return renderEmailLayout({
        subject: `${mail.mail === 'reminder' ? 'Reminder: ' : ''}${minor} asked you to sign a media release · Daisy`,
        preheader: `Nobody may clip, download or reuse ${minor}’s debate Rounds unless you sign. About two minutes.`,
        eyebrow: 'Media release',
        headline: `${minor} asked you to sign a media release`,
        paragraphs: [
          `${minor} debates on Daisy Debate, an online debate platform. Their Rounds can be watched on Daisy under each Room’s own settings, and ranked Rounds are public. Because they are under 18, nobody may clip, download or reuse them without a release.`,
          'If you sign, Daisy and others may clip, download and reuse their Rounds. Using clips in paid advertising is a separate choice, off unless you turn it on. You can withdraw at any time.',
          'It takes about two minutes. You don’t need a Daisy account.',
          `This link works until ${until}.`,
        ],
        linkLabel: 'Read and sign',
        url: links.url,
        footerNote: `You get this email because ${minor} gave Daisy your address. If you don’t know them, ignore it: nothing happens unless you sign. Daisy Debate never asks for a password by email.`,
        unsubscribe: {
          label: 'Don’t send me release requests',
          url: links.stopUrl,
        },
      });
    case 'copy':
    case 'manage_link': {
      const signed = mail.signed;
      const record =
        signed === null
          ? []
          : [
              `Signed by ${signed.name}, ${guardianRelationWords[signed.relation]}, on ${releaseDate(signed.signedAt)}. Release version ${signed.wordingVersion}.`,
              `Clipping, download and reuse: allowed. Paid advertising: ${signed.paidAds ? 'allowed' : 'not allowed'}.`,
            ];
      return renderEmailLayout({
        subject:
          mail.mail === 'copy'
            ? `Your copy of ${minor}’s media release · Daisy`
            : `Your link to manage ${minor}’s media release · Daisy`,
        preheader: `Withdraw it, or change the paid-ads choice, from this email.`,
        eyebrow: 'Media release',
        headline:
          mail.mail === 'copy'
            ? `Your copy of ${minor}’s media release`
            : `Manage ${minor}’s media release`,
        paragraphs: [
          ...record,
          `Withdraw it, or change the paid-ads choice, from the link below. It works once, until ${until}. After that, ask for a new one at ${links.manageUrl}.`,
        ],
        linkLabel: 'Withdraw or change',
        url: links.url,
        footerNote:
          'You get this email because you signed a media release on Daisy Debate. Daisy Debate never asks for a password by email.',
      });
    }
  }
}
