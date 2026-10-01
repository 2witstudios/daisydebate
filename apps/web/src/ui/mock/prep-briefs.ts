import type {
  Brief,
  BriefCardRef,
  BriefResponse,
  Contention,
} from '../../features/prep/brief';
import { sampleTeamName } from './prep';

/**
 * The debate rules' speech limit: Daisy has no speech times yet, so this is
 * a sample constant the mock uses for the time bars. The screen never prints
 * it; it prints "[speech time]".
 */
export const sampleSpeechLimitSeconds = 360;

/** Placeholder spoken words: `n`-ish words that say plainly they are samples. */
const filler = (label: string, n: number): string =>
  `[${label}] ${Array.from(
    { length: Math.max(0, Math.ceil((n - 1) / 7)) },
    () => '[Sample sentence standing in for spoken words.]',
  ).join(' ')}`.trim();

const ref = (
  cardId: string,
  title: string,
  cite: string,
  words: number,
): BriefCardRef => ({
  cardId,
  title,
  cite,
  words,
});

const institutions = ref(
  'framework-institutions',
  'The framework applies to institutions, not only persons',
  '[Author C] [year]',
  34,
);
const survive = ref(
  'rights-survive-policy',
  'Rights claims survive changes in policy',
  '[Author D] [year]',
  41,
);
const costs = ref(
  'cost-estimates',
  'Cost estimates depend on assumed take-up',
  '[Author A] [year]',
  29,
);
const pilot = ref(
  'pilot-results',
  'Pilot results do not transfer across regions',
  '[Author B] [year]',
  36,
);

const responses = (
  ...pairs: readonly (readonly [string, string])[]
): readonly BriefResponse[] => pairs.map(([say, we]) => ({ say, we }));

const contention = (
  n: number,
  tag: string,
  words: { claim: number; warrant: number; impact: number },
  cards: readonly BriefCardRef[],
  replies: readonly BriefResponse[],
): Contention => ({
  id: `c${n}`,
  tag,
  claim: filler('Claim', words.claim),
  warrant: filler('Warrant', words.warrant),
  impact: filler('Impact', words.impact),
  cards,
  responses: replies,
});

const team = { kind: 'team', teamName: sampleTeamName } as const;

export const sampleBriefs: readonly Brief[] = [
  {
    id: 'rights-framework',
    title: 'Affirmative case: rights-based framework',
    side: 'aff',
    motion: '[Motion A]',
    visibility: team,
    savedAt: '12:04',
    framing: {
      motion: 'Resolved: [motion text]',
      burden: filler('How the round should be decided, in spoken words.', 146),
      cards: [institutions],
    },
    contentions: [
      contention(
        1,
        'The framework protects what a majority cannot vote away',
        { claim: 14, warrant: 293, impact: 58 },
        [institutions, survive],
        responses([
          '[They say: the framework is too abstract.]',
          '[We say: it is applied to a concrete case in the second contention.]',
        ]),
      ),
      contention(
        2,
        'Costs do not defeat a rights claim',
        { claim: 14, warrant: 279, impact: 58 },
        [costs],
        responses(
          [
            '[They say: the costs are too high.]',
            '[We say: cost bears on the means, not on the right.]',
          ],
          [
            '[They say: the pilot results are strong.]',
            '[We say: they do not transfer across regions.]',
          ],
        ),
      ),
      contention(
        3,
        'Implementation fails without an enforcement path',
        { claim: 14, warrant: 312, impact: 58 },
        [pilot],
        responses([
          '[They say: enforcement is someone else’s problem.]',
          '[We say: a right with no path is a hope.]',
        ]),
      ),
    ],
  },
  {
    id: 'neg-implementation-costs',
    title: 'Negative block: implementation costs',
    side: 'neg',
    motion: '[Motion A]',
    visibility: { kind: 'private' },
    savedAt: '09:30',
    framing: {
      motion: 'Resolved: [motion text]',
      burden: filler('Burden and weighing', 60),
      cards: [],
    },
    contentions: [
      contention(
        1,
        'Costs depend on take-up',
        { claim: 14, warrant: 120, impact: 40 },
        [costs],
        responses(),
      ),
      contention(
        2,
        'Pilots do not transfer',
        { claim: 14, warrant: 100, impact: 40 },
        [pilot],
        responses(),
      ),
      contention(
        3,
        'Enforcement is unfunded',
        { claim: 14, warrant: 90, impact: 40 },
        [],
        responses(),
      ),
    ],
  },
  {
    id: 'framing-pack',
    title: 'Framing pack: burden and standards',
    side: 'aff',
    motion: '[Motion B]',
    visibility: { kind: 'private' },
    savedAt: '16:45',
    framing: {
      motion: 'Resolved: [motion text]',
      burden: filler('Burden and weighing', 90),
      cards: [],
    },
    contentions: [
      contention(
        1,
        'The burden sits with the side that changes the rule',
        { claim: 14, warrant: 80, impact: 30 },
        [],
        responses(),
      ),
      contention(
        2,
        'Weigh by what cannot be undone',
        { claim: 14, warrant: 80, impact: 30 },
        [],
        responses(),
      ),
    ],
  },
  {
    id: 'opening-statements',
    title: 'Opening statements, [Motion B]',
    side: 'neg',
    motion: '[Motion B]',
    visibility: team,
    savedAt: '08:15',
    framing: {
      motion: 'Resolved: [motion text]',
      burden: filler('Burden and weighing', 50),
      cards: [],
    },
    contentions: [
      contention(
        1,
        'Opening line one',
        { claim: 14, warrant: 70, impact: 30 },
        [],
        responses(),
      ),
      contention(
        2,
        'Opening line two',
        { claim: 14, warrant: 70, impact: 30 },
        [],
        responses(),
      ),
    ],
  },
];

/** The brief a "New brief" starts from: nothing written yet. */
export const emptyBrief: Brief = {
  id: 'new',
  title: '',
  side: 'aff',
  motion: '',
  visibility: { kind: 'private' },
  savedAt: '',
  framing: { motion: '', burden: '', cards: [] },
  contentions: [
    {
      id: 'c1',
      tag: '',
      claim: '',
      warrant: '',
      impact: '',
      cards: [],
      responses: [],
    },
  ],
};
