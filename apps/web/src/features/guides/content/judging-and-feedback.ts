import type { Article, Collection } from '../article';

export const judgingAndFeedbackCollection: Collection = {
  home: 'learn',
  slug: 'judging-and-feedback',
  title: 'Judging and feedback',
  summary:
    'Decide a round fairly, explain the decision clearly, and give feedback a debater can use.',
};

const base = { home: 'learn', collection: 'judging-and-feedback' } as const;
const updated = '2026-11-23';

export const judgingAndFeedbackArticles: readonly Article[] = [
  {
    ...base,
    slug: 'making-a-decision',
    title: 'Making a decision',
    summary:
      'How to decide who won from what was argued in the round, not from what you already believe.',
    updated,
    blocks: [
      {
        kind: 'paragraph',
        text: 'A judge decides which side did the better job of debating the resolution in this round. You are not deciding whether the resolution is true, or which side you agree with. The question is narrower and fairer: given only what was said, whose case is still standing at the end?',
      },
      { kind: 'heading', id: 'track', text: 'Track the round as it happens' },
      {
        kind: 'paragraph',
        text: 'Write each side’s main arguments in a column of their own, and write each answer next to the argument it answers. By the last speech you should be able to see, at a glance, which arguments were answered and which were dropped.',
      },
      { kind: 'heading', id: 'burdens', text: 'Start from the burdens' },
      {
        kind: 'paragraph',
        text: 'Each side should say what must be true for it to win: its burdens. If the sides disagree about the burdens, that disagreement often decides the round. Settle it first, using the arguments the debaters made about it, and judge the rest of the round under the burdens that won.',
      },
      { kind: 'heading', id: 'weigh', text: 'Weigh what still stands' },
      {
        kind: 'steps',
        items: [
          'Set aside the arguments that were answered and not rebuilt.',
          'For what remains on each side, ask how big it is, how likely it is, and whether it meets the burdens.',
          'Prefer the comparison the debaters made. If they told you why their argument outweighs, and the other side never answered that, use their weighing.',
          'Only when neither side weighed do you compare the arguments yourself, and then say so in your reason.',
        ],
      },
      {
        kind: 'heading',
        id: 'keep-out',
        text: 'Keep yourself out of it',
      },
      {
        kind: 'list',
        items: [
          'Do not add arguments a debater could have made but did not.',
          'Do not reward the side you agree with, or the more confident speaker, for that alone.',
          'A dropped argument is not automatically decisive: it still has to matter to the burdens.',
          'Delivery and organization are scored, but the decision follows the arguments.',
        ],
      },
      {
        kind: 'paragraph',
        text: 'On Daisy, the scores record how well each debater did in each part of the round, and the decision records who won it. See how they fit on [Understanding a Daisy ballot](/guides/judging/understanding-a-ballot).',
      },
    ],
    related: [
      'learn/judging-and-feedback/writing-a-reason-for-decision',
      'guides/judging/during-the-round',
    ],
    sources: ['packages/protocol/src/ballot-rubrics.ts'],
  },
  {
    ...base,
    slug: 'writing-a-reason-for-decision',
    title: 'Writing a clear reason for decision',
    summary:
      'A reason both debaters can follow: the deciding question, how it was won, and why it mattered most.',
    updated,
    blocks: [
      {
        kind: 'paragraph',
        text: 'Your reason for decision is the part of the ballot both debaters read most closely. It should let the debater who lost see exactly where the round turned, and let the debater who won see what earned it.',
      },
      { kind: 'heading', id: 'shape', text: 'A shape that works' },
      {
        kind: 'steps',
        items: [
          'Name the winner and the question the round came down to.',
          'Say how the winner won that question: the argument, and the answer that failed or never came.',
          'Say why that question mattered more than the others.',
        ],
      },
      {
        kind: 'paragraph',
        text: 'On Daisy a reason can be up to 600 characters: a short paragraph. That is enough for those three steps, and it is a good discipline: if you cannot say in a short paragraph why a side won, go back to your notes.',
      },
      { kind: 'heading', id: 'examples', text: 'Weak and clear' },
      {
        kind: 'example',
        label: 'Weak',
        text: 'Negative wins. Better arguments and a stronger rebuttal. Good round from both of you!',
      },
      {
        kind: 'example',
        label: 'Clear',
        text: 'Negative wins on the burden. Both sides agreed the Affirmative had to show the policy would reduce harm. The Negative’s point that harm moves rather than falls was never answered, and the Affirmative’s evidence only covered one city. Without that burden met, the Affirmative’s benefits never came into play.',
      },
      {
        kind: 'paragraph',
        text: 'The weak reason could be pasted onto any round. The clear one could only be about this one.',
      },
      { kind: 'heading', id: 'avoid', text: 'What to leave out' },
      {
        kind: 'list',
        items: [
          'Arguments nobody made in the round.',
          'Your view of the resolution.',
          'Comments about the person rather than the debating.',
          'Advice for one debater: that is what feedback is for.',
        ],
      },
    ],
    related: [
      'learn/judging-and-feedback/writing-useful-feedback',
      'guides/judging/understanding-a-ballot',
    ],
    sources: ['packages/protocol/src/ballot.ts'],
  },
  {
    ...base,
    slug: 'writing-useful-feedback',
    title: 'Writing useful feedback',
    summary:
      'Short, specific notes one debater can act on in their next round.',
    updated,
    blocks: [
      {
        kind: 'paragraph',
        text: 'Feedback is a private note to one debater. Where the reason explains the decision, feedback helps that debater improve. Each debater reads only their own, so you can be specific to them.',
      },
      { kind: 'heading', id: 'one-thing', text: 'One thing they can change' },
      {
        kind: 'paragraph',
        text: 'On Daisy feedback is up to 280 characters. Use it for one change that would have made the biggest difference, tied to a moment in the round, and say what to do instead.',
      },
      { kind: 'heading', id: 'examples', text: 'Weak and useful' },
      {
        kind: 'example',
        label: 'Weak',
        text: 'Work on your rebuttals and speak more clearly.',
      },
      {
        kind: 'example',
        label: 'Useful',
        text: 'In your rebuttal you answered their examples but not the premise they relied on. Next time, name the premise in one line and attack that first: it would have taken their whole case with it.',
      },
      {
        kind: 'example',
        label: 'Useful',
        text: 'Your cross-ex won a real concession on cost, then you never mentioned it again. Bring concessions into your next speech by name: “they agreed in cross-ex that…”.',
      },
      {
        kind: 'heading',
        id: 'use-the-rubric',
        text: 'Use the rubric as a map',
      },
      {
        kind: 'paragraph',
        text: 'A low score in one category is a good place to look for feedback. If you gave Weighing a 2, the useful note is usually how to compare: magnitude, likelihood, and which burden the comparison serves.',
      },
      { kind: 'heading', id: 'tone', text: 'Tone' },
      {
        kind: 'list',
        items: [
          'Talk about what they did, never who they are.',
          'Be direct; a vague kindness is harder to use than a clear note.',
          'If something they did worked, say so: it tells them what to keep.',
        ],
      },
    ],
    related: [
      'learn/judging-and-feedback/writing-a-reason-for-decision',
      'guides/judging/understanding-a-ballot',
    ],
    sources: [
      'packages/protocol/src/ballot.ts',
      'packages/protocol/src/ballot-rubrics.ts',
    ],
  },
];
