import type { LegalDocument } from './documents';

/**
 * What a member agrees to before play, each text with the version a signature
 * records. All of it is a draft for counsel, and says so; changing a text
 * means changing its version (agreements.test.ts pins each pair).
 * Source of truth for the wording: docs/legal/ranked-content-waiver.md and
 * docs/legal/ranked-content-policy.md.
 */
export const CONTENT_WAIVER_VERSION = 'draft-1';
export const CONTENT_POLICY_VERSION = 'draft-1';

const draftForCounsel =
  'This is a draft for counsel and has not been reviewed; the wording may change after that review.';

export const contentWaiverDocument: LegalDocument = {
  title: 'Ranked content waiver',
  version: CONTENT_WAIVER_VERSION,
  lede: `What you agree to before your first ranked round of a season, separately from the terms of service. ${draftForCounsel}`,
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
        'Daisy owns what is said and shown in a ranked round, including its video and transcript. It stays after you close your account, because ranked season rounds are qualifying artifacts for tournaments.',
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
        'A stream of a ranked round must not carry assistance to a debater in that round. Relaying arguments is a competitive violation that can be reported.',
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
  lede: `How anyone may stream and post ranked rounds. ${draftForCounsel}`,
  sections: [
    {
      id: 'stream-and-post',
      heading: 'Stream and post it',
      paragraphs: [
        'Anyone may stream and post ranked rounds, with or without an account, anywhere. You may earn from it, and Daisy charges no royalty. We ask for good faith: say where it came from, and do not present it as something it was not.',
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
      id: 'no-help-through-a-stream',
      heading: 'No help through a stream',
      paragraphs: [
        'A stream of a ranked round must not carry assistance to a debater in that round. Relaying arguments is a competitive violation that can be reported.',
      ],
    },
    {
      id: 'no-limits-on-competitors',
      heading: 'No limits on competitors',
      paragraphs: [
        'The ranked ladder places no exclusive broadcast, no streaming limit and no commercial restriction on competitors. Those may apply only to a tournament, under its own per-event terms.',
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
    version: 'ranked-draft-1',
    text: 'This ranked round is public, broadcast with a delay and recorded. Its video stays after you close your account, and you cannot remove it; moderation can still take it down. A subscriber can download a recording, and a copy outside Daisy is beyond erasure and takedown.',
  },
  'opted-in': {
    version: 'casual-draft-1',
    text: 'The host chose to broadcast or record this round. A casual recording ends when any participant removes it, and the whole recording goes. A subscriber can download a recording, and a copy outside Daisy is beyond erasure and takedown.',
  },
};

/** The exact notice shown before Ready, or null when nothing is captured. */
export const roundCaptureNotice = (
  capture: RoundCapture,
): RoundCaptureNotice | null => (capture === 'none' ? null : notices[capture]);
