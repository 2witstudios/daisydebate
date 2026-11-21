import { createHash } from 'node:crypto';
import type { GuardianNoticeKind } from '@daisy/protocol/guardians';
import type { LegalDocument } from './documents';
import { agreementWords } from './agreements';

/**
 * The two notices a guardian link records agreement to (ADR 0163): the
 * parent's consent, and the child's confirmation of that parent. Changing a
 * text means changing its version (guardian-notices.test.ts pins each pair).
 * Neither has been reviewed by counsel; both are on the counsel brief and
 * served only behind the parental-controls release flag.
 */
const notReviewed =
  'This text has not been reviewed by counsel, and its wording may change after any review.';

const parentalConsentNotice: LegalDocument = {
  title: 'Parental consent notice',
  version: 'draft-1',
  lede: `What you agree to as the parent or legal guardian of a child aged 13 to 17 on Daisy. ${notReviewed}`,
  sections: [
    {
      id: 'who-you-are',
      heading: 'Who you are',
      paragraphs: [
        'You confirm that you are this child’s parent or legal guardian. A coach or club is not a guardian on Daisy; if you only coach this child, use your club instead.',
      ],
    },
    {
      id: 'what-you-consent-to',
      heading: 'What you consent to',
      paragraphs: [
        'You consent to your child holding a Daisy account and taking part under Daisy’s rules for members under 18, and to Daisy keeping the account details described in the privacy notice.',
      ],
    },
    {
      id: 'what-you-can-do',
      heading: 'What you can do',
      paragraphs: [
        'While you are linked, you can see the Youth rounds Daisy makes available to parents and guardians, including private rounds. Your child can see that you are linked. You cannot read their messages.',
      ],
    },
    {
      id: 'how-a-link-starts',
      heading: 'How a link starts',
      paragraphs: [
        'If you create your child’s account, the link starts when they first sign in. If they already have an account, nothing changes until they confirm you from their own account. If they say you are not their parent, Daisy’s safety team is told.',
      ],
    },
    {
      id: 'the-record',
      heading: 'The record Daisy keeps',
      paragraphs: [
        'Daisy records who agreed, when, and to which version of this notice. That record is kept even after the link ends.',
      ],
    },
  ],
};

const childConfirmationNotice: LegalDocument = {
  title: 'Confirming your parent',
  version: 'draft-1',
  lede: `What happens when you confirm that someone is your parent or guardian on Daisy. ${notReviewed}`,
  sections: [
    {
      id: 'only-if-its-them',
      heading: 'Only if it’s really them',
      paragraphs: [
        'Only confirm someone you know is your parent or legal guardian. If they are not, say so: Daisy’s safety team is told, not them.',
      ],
    },
    {
      id: 'what-they-can-do',
      heading: 'What they can do',
      paragraphs: [
        'They can see the Youth rounds Daisy makes available to parents and guardians, including private rounds. They cannot read your messages.',
      ],
    },
    {
      id: 'the-record',
      heading: 'The record Daisy keeps',
      paragraphs: [
        'Daisy records that you confirmed them, when, and to which version of this notice.',
      ],
    },
  ],
};

const notices: Record<GuardianNoticeKind, LegalDocument> = {
  'parental-consent': parentalConsentNotice,
  'child-confirmation': childConfirmationNotice,
};

/** A notice as agreement records it: its version, exact words and their digest. */
export type ServedNotice = {
  readonly kind: GuardianNoticeKind;
  readonly version: string;
  readonly words: string;
  /** SHA3-256 of the words, hex. */
  readonly digest: string;
};

/** The notice of a kind now in force, as a signature would record it. */
export function servedNotice(kind: GuardianNoticeKind): ServedNotice {
  const document = notices[kind];
  const words = agreementWords(document);
  return {
    kind,
    version: document.version,
    words,
    digest: createHash('sha3-256').update(words).digest('hex'),
  };
}

/** The notice document itself, for the page that shows it. */
export const guardianNoticeDocument = (
  kind: GuardianNoticeKind,
): LegalDocument => notices[kind];
