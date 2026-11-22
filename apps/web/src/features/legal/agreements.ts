import type { AgeBand } from '@daisy/protocol/ladder';
import type { LegalDocument } from './documents';

/**
 * What a member agrees to before play, each text with the version and the
 * words a signature records. None of it has been reviewed by counsel, and it
 * says so; legal review blocks nothing. Changing a text means changing its
 * version (agreements.test.ts pins each pair).
 * Source of truth for the wording: docs/legal/ranked-content-waiver.md,
 * docs/legal/youth-ranked-content-waiver.md and
 * docs/legal/ranked-content-policy.md.
 */
export const CONTENT_WAIVER_VERSION = 'draft-5';
/** The Youth lobby's waiver (ADR 0161): no licence, signed in place of the Open one. */
export const YOUTH_CONTENT_WAIVER_VERSION = 'youth-draft-1';
const CONTENT_POLICY_VERSION = 'draft-5';

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
        'Ranked rounds are always public, and they are broadcast and recorded. If every capture machine is busy, a round can run without a broadcast or recording; the debate and its result are not affected. Competing in one is the deal. If you do not want this, play casual.',
      ],
    },
    {
      id: 'in-round-content',
      heading: 'In-round content',
      paragraphs: [
        'Daisy owns what is said and shown by adult debaters in a ranked round, including their contributions to its video and transcript. The round stays after you close your account, because ranked season rounds are qualifying artifacts for tournaments.',
      ],
    },
    {
      id: 'youth-debaters',
      heading: 'Youth debaters',
      paragraphs: [
        'For a debater under 18, this waiver covers ranked play, public viewing on Daisy and keeping the round on Daisy. It gives Daisy no ownership of that debater’s contribution. Clipping, streaming, posting or otherwise reusing the round requires a separate media release covering every youth debater in it, including in an adult lobby.',
      ],
    },
    {
      id: 'clips-and-media',
      heading: 'Clips and other media',
      paragraphs: [
        'Where the Youth debaters section permits reuse, Daisy may edit ranked rounds into clips and other media, and use your name and likeness in them, to broadcast and promote ranked play. This includes clips made by hand from this release on.',
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

/**
 * The Youth lobby's ranked waiver (decision 89, ADR 0161): ranked Rounds are
 * public, watched and kept, and nothing more. It grants Daisy no ownership,
 * clips, likeness or stream-and-earn licence; a media release alone does.
 */
export const youthContentWaiverDocument: LegalDocument = {
  title: 'Youth ranked content waiver',
  version: YOUTH_CONTENT_WAIVER_VERSION,
  lede: `What you agree to before your first ranked round of a season in the Youth lobby, separately from the terms of service. ${notReviewed}`,
  sections: [
    {
      id: 'the-deal',
      heading: 'The deal',
      paragraphs: [
        'Ranked rounds are always public, and they are broadcast and recorded. Anyone can watch them live and replay them on Daisy, and they show on your profile and in the archive. If every capture machine is busy, a round can run without a broadcast or recording; the debate and its result are not affected. Competing in one is the deal. If you do not want this, play casual.',
      ],
    },
    {
      id: 'kept-on-daisy',
      heading: 'Kept on Daisy',
      paragraphs: [
        "A ranked round's video, transcript and result stay on Daisy as part of the ladder's record, including after you close your account. You, or a parent, guardian or school staff member linked to you, can ask for a round's recording to be taken down at any time.",
      ],
    },
    {
      id: 'no-licence',
      heading: 'No licence to your content',
      paragraphs: [
        'Signing this gives Daisy no ownership of what you say or show, and no right to clip it, to use your name or likeness in other media, or to let anyone stream or post it. Daisy offers no download of your ranked rounds and no Stream this Round feed of them. That changes only while a media release from your parent or guardian, or from your club, covers every youth debater in the round.',
      ],
    },
    {
      id: 'payment',
      heading: 'Payment',
      paragraphs: ['This waiver promises no payment.'],
    },
    {
      id: 'what-stays-yours',
      heading: 'What stays yours',
      paragraphs: [
        'What you say and show, your prep material and your drives stay yours, ranked rounds included.',
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

/** The ranked waiver selected by the signer's age band (ADR 0161). */
export const contentWaiverOf = (ageBand: AgeBand): LegalDocument =>
  ageBand === 'adult' ? contentWaiverDocument : youthContentWaiverDocument;

/** The waiver served at this version, if it is one served now. */
export const contentWaiverAt = (version: string): LegalDocument | null =>
  [contentWaiverDocument, youthContentWaiverDocument].find(
    (document) => document.version === version,
  ) ?? null;

export const contentPolicyDocument: LegalDocument = {
  title: 'Ranked content policy',
  version: CONTENT_POLICY_VERSION,
  lede: `How anyone may stream and post ranked rounds. ${notReviewed}`,
  sections: [
    {
      id: 'stream-and-post',
      heading: 'Stream and post it',
      paragraphs: [
        'Anyone may stream and post ranked rounds covered by this policy, with or without an account, anywhere. You may earn from it, and Daisy charges no royalty. We ask for good faith: say where it came from, and do not present it as something it was not.',
      ],
    },
    {
      id: 'stream-this-round',
      heading: 'Stream this Round',
      paragraphs: [
        "For ranked rounds covered by this policy, the easiest way to stream is Stream this Round. The round's page on Daisy offers its official feed, with Daisy's branding and a link back already in the video, and needs no stream key from Daisy. Add your own camera and commentary if you like. You may also stream eligible rounds with your own tools or by screen capture, subject to the Youth rounds section.",
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
    {
      id: 'youth-rounds',
      heading: 'Youth rounds',
      paragraphs: [
        'This policy does not grant permission to stream, post or reuse a round with a debater under 18, including in an adult lobby. That requires a separate media release covering every youth debater in the round. Until then, Daisy offers no download or Stream this Round feed.',
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

export type RoundCaptureNotice = {
  readonly version: string;
  readonly text: string;
};

/**
 * The one capture notice: what a seat reads before Ready when a casual host
 * chose a broadcast or a recording. A ranked Round has none, because the ranked
 * content waiver is its agreement.
 */
export const casualCaptureNotice: RoundCaptureNotice = {
  version: 'casual-draft-1',
  text: 'The host chose to broadcast or record this round. A casual recording ends when any participant removes it, and the whole recording goes. A subscriber can download a recording, and a copy outside Daisy is beyond erasure and takedown.',
};
