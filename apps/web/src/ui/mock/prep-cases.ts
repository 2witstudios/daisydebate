import type { Block, Case, Speech } from '../../features/prep/case';
import { sampleTeamName } from './prep';

const fw = 'Brief: rights-based framework';
const b = (
  id: string,
  title: string,
  sub: string,
  words: number,
  more: Partial<Block> = {},
): Block => ({ id, kind: 'brief', title, sub, words, ...more });
const card = (
  id: string,
  title: string,
  sub: string,
  words: number,
  cardId: string,
): Block => ({
  id,
  kind: 'card',
  title,
  sub,
  words,
  href: `/prep/cards/${cardId}`,
});
const note = (id: string, title: string, words: number): Block => ({
  id,
  kind: 'note',
  title,
  sub: 'Your text',
  words,
});
const speech = (n: number, blocks: readonly Block[]): Speech => ({
  id: `s${n}`,
  label: `[Speech ${n}]`,
  blocks,
});

const framing = b('fr', 'Framing', fw, 180);
const c1 = b('c1', 'Contention 1', fw, 440);
const c2Old = b('c2', 'Contention 2', fw, 380, {
  text: 'Costs do not outweigh a rights claim',
});
const c2New = b('c2', 'Contention 2', fw, 380, {
  text: 'Costs do not defeat a rights claim on the means',
});
const c3 = b('c3', 'Contention 3', fw, 420);
const answers = b(
  'ans',
  'Answers to cost objections',
  'Brief: implementation costs',
  267,
);
const cardInstitutions = card(
  'k-inst',
  'Card: The framework applies to institutions…',
  '[Author C] [year]',
  34,
  'framework-institutions',
);
const cardPilot = card(
  'k-pilot',
  'Card: Pilot results do not transfer across regions',
  '[Author B] [year]',
  36,
  'pilot-results',
);
const cardSurvive = card(
  'k-survive',
  'Card: Rights claims survive changes in policy',
  '[Author D] [year]',
  41,
  'rights-survive-policy',
);
const voting = note('n-voting', 'Voting issues', 213);

const v4: readonly Speech[] = [
  speech(1, [framing, c1, c2Old]),
  speech(2, [c3, answers, cardPilot]),
  speech(3, [voting]),
];

/** Sample cases; ids match the library's case items. */
export const sampleCases: readonly Case[] = [
  {
    id: 'aff-rights',
    title: 'Affirmative, rights-based',
    motion: '[Motion A]',
    side: 'aff',
    visibility: { kind: 'team', teamName: sampleTeamName },
    sharedRight: 'can comment',
    versions: [
      {
        version: 4,
        note: 'Moved Contention 3 to the front',
        when: '2 days ago',
        speeches: v4,
      },
      {
        version: 3,
        note: 'Added transition notes',
        when: 'Last week',
        speeches: [
          speech(1, [framing, c1, c2Old]),
          speech(2, [answers, c3, cardPilot]),
          speech(3, [voting]),
        ],
      },
      {
        version: 2,
        note: 'First full draft',
        when: '[yyyy-mm-dd]',
        speeches: [speech(1, [framing, c1]), speech(2, [answers, c3])],
      },
      {
        version: 1,
        note: 'Created from brief',
        when: '[yyyy-mm-dd]',
        speeches: [speech(1, [framing])],
      },
    ],
    draft: {
      since: 'Since v4 at 12:04',
      speeches: [
        speech(1, [
          framing,
          c1,
          cardInstitutions,
          c2New,
          note('n-transition', 'Transition note', 16),
        ]),
        speech(2, [c3, answers]),
        speech(3, [voting, cardSurvive]),
      ],
    },
  },
  {
    id: 'neg-costs-first',
    title: 'Negative, costs first',
    motion: '[Motion A]',
    side: 'neg',
    visibility: { kind: 'private' },
    sharedRight: '',
    versions: [
      {
        version: 2,
        note: 'Costs moved to the front',
        when: 'Last week',
        speeches: [
          speech(1, [
            b('n-c1', 'Costs first', 'Brief: implementation costs', 300),
            {
              id: 'k-gone',
              kind: 'card',
              title: 'Card removed from your library',
              sub: 'Deleted card',
              words: 30,
              removed: true,
            },
          ]),
          speech(2, [note('n-wrap', 'Closing note', 90)]),
        ],
      },
      {
        version: 1,
        note: 'Created from brief',
        when: '[yyyy-mm-dd]',
        speeches: [
          speech(1, [
            b('n-c1', 'Costs first', 'Brief: implementation costs', 300),
          ]),
        ],
      },
    ],
    draft: null,
  },
];
