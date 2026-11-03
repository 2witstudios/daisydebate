import type { LegalDocument } from './documents';

/**
 * What a member agrees to before play, each text with the version and the
 * words a signature records. None of it has been reviewed by counsel, and it
 * says so; legal review blocks nothing. Changing a text means changing its
 * version (agreements.test.ts pins each pair).
 * Source of truth for the wording: docs/legal/ranked-content-waiver.md and
 * docs/legal/ranked-content-policy.md.
 */
export const CONTENT_WAIVER_VERSION = 'draft-4';
export const CONTENT_POLICY_VERSION = 'draft-3';

const notReviewed =
  'This text has not been reviewed by counsel, and its wording may change after any review.';

export const contentWaiverDocument: LegalDocument = {
  title: 'Ranked content waiver',
  version: CONTENT_WAIVER_VERSION,
  lede: `What you agree to before your first ranked round of a season, separately from the terms of service. ${notReviewed}`,
  sections: [
    {
      id: 'the-deal',
      heading: 'The deal',
      paragraphs: [
        'Ranked rounds are always public, always broadcast and always recorded. Competing in one is the deal. If you do not want this, play casual.',
      ],
    },
    {
      id: 'in-round-content',
      heading: 'In-round content',
      paragraphs: [
        "Daisy owns what is said and shown in a ranked round, including its video and transcript. That video includes each debater's own camera and voice as separate files, which any subscriber who may watch the round can download. It stays after you close your account, because ranked season rounds are qualifying artifacts for tournaments.",
      ],
    },
    {
      id: 'clips-and-media',
      heading: 'Clips and other media',
      paragraphs: [
        'Daisy may edit ranked rounds into clips and other media, and use your name and likeness in them, to broadcast and promote ranked play. This includes clips made by hand from this release on.',
      ],
    },
    {
      id: 'payment',
      heading: 'Payment',
      paragraphs: [
        'This waiver promises no payment. Any revenue share would be a future program, not part of the beta.',
      ],
    },
    {
      id: 'what-stays-yours',
      heading: 'What stays yours',
      paragraphs: [
        'Your prep material and drives stay yours, ranked rounds included.',
      ],
    },
    {
      id: 'streaming-and-posting',
      heading: 'Streaming and posting',
      paragraphs: [
        'You and anyone else may stream and post ranked rounds under the ranked content policy, with no royalty, and Daisy may restrict or take down ranked content. The ranked ladder has no exclusive broadcast, no streaming limit and no commercial restriction on competitors.',
      ],
    },
    {
      id: 'other-rounds',
      heading: 'Other rounds and events',
      paragraphs: [
        'A non-ranked round is not covered: its content stays with its participants. A tournament may have its own per-event terms.',
      ],
    },
  ],
};

export const contentPolicyDocument: LegalDocument = {
  title: 'Ranked content policy',
  version: CONTENT_POLICY_VERSION,
  lede: `How anyone may stream and post ranked rounds. ${notReviewed}`,
  sections: [
    {
      id: 'stream-and-post',
      heading: 'Stream and post it',
      paragraphs: [
        'Anyone may stream and post ranked rounds, with or without an account, anywhere. You may earn from it, and Daisy charges no royalty. We ask for good faith: say where it came from, and do not present it as something it was not.',
      ],
    },
    {
      id: 'stream-this-round',
      heading: 'Stream this Round',
      paragraphs: [
        "The easiest way to stream a ranked round is Stream this Round: the round's page on Daisy offers its official feed, with Daisy's branding and a link back already in the video, and needs no stream key from Daisy. Add your own camera and commentary if you like. On the ranked ladder you may also stream with your own tools or by screen capture.",
      ],
    },
    {
      id: 'what-daisy-keeps',
      heading: 'What Daisy keeps',
      paragraphs: [
        'Daisy may restrict or take down ranked content, including copies posted elsewhere where it has the right to ask, when it breaks this policy or the terms.',
      ],
    },
    {
      id: 'no-limits-on-competitors',
      heading: 'No limits on competitors',
      paragraphs: [
        'The ranked ladder places no exclusive broadcast, no streaming limit and no commercial restriction on competitors. Those may apply only to a tournament, under its own per-event terms, which may also ban screen capture and self-streaming.',
      ],
    },
    {
      id: 'non-ranked-rounds',
      heading: 'Non-ranked rounds',
      paragraphs: [
        'This policy does not cover non-ranked rounds. Their content stays with their participants.',
      ],
    },
  ],
};

/** The exact words of an agreement, as its signature records them. */
export const agreementWords = (document: LegalDocument): string =>
  [
    document.title,
    document.lede,
    ...document.sections.flatMap((section) => [
      section.heading,
      ...section.paragraphs,
    ]),
  ].join('\n\n');

/** What a Round captures for its audience, which is what its notice must say. */
export type RoundCapture = 'ranked' | 'opted-in' | 'none';

export type RoundCaptureNotice = {
  readonly version: string;
  readonly text: string;
};

const notices: Readonly<
  Record<Exclude<RoundCapture, 'none'>, RoundCaptureNotice>
> = {
  ranked: {
    version: 'ranked-draft-2',
    text: "This ranked round is public, broadcast with a delay and recorded. Its video, including each debater's own camera and voice as separate files, stays after you close your account, and you cannot remove it; moderation can still take it down. A subscriber can download a recording and those files, and a copy outside Daisy is beyond erasure and takedown.",
  },
  'opted-in': {
    version: 'casual-draft-2',
    text: "The host chose to broadcast or record this round. A recording includes each debater's own camera and voice as separate files. A casual recording ends when any participant removes it, and the whole recording goes, those files with it. A subscriber can download a recording and those files, and a copy outside Daisy is beyond erasure and takedown.",
  },
};

/** The exact notice shown before Ready, or null when nothing is captured. */
export const roundCaptureNotice = (
  capture: RoundCapture,
): RoundCaptureNotice | null => (capture === 'none' ? null : notices[capture]);
