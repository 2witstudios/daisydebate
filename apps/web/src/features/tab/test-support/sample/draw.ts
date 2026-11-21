import { affirmativeSide, negativeSide, twoSideKeys } from '@daisy/protocol';
import type {
  DrawView,
  DrawViewFixture,
} from '@daisy/protocol/lobby/draw-read';
import type { DrawBoardContext } from '../../draw';
import { hostRoutes } from '../../routes';
import { AUTUMN, reached, VARSITY } from './moment';
import { varsitySwitch } from './event-switch';
import { largeDrawView } from './large-draw';
import { atScale, type SampleScene } from './scene';

/** A sample's stand-in for a cuid2 id: the seed's letters, padded to 24. */
const sampleId = (seed: string): string =>
  seed
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, '')
    .padEnd(24, '0')
    .slice(0, 24);

const spareJudges = ['A. Shah', 'M. Reyes'];

type Finding = DrawViewFixture['findings'][number];

/** A pairing whose first entry takes the Affirmative. */
const plain = (
  slug: string,
  title: string,
  judge: string,
  findings: readonly Finding[] = [],
): DrawViewFixture => {
  const [affirmative = '', negative = ''] = title.split(' v ');
  return {
    fixtureId: sampleId(`fixture${slug}`),
    kind: 'pairing',
    status: 'draft',
    entries: [
      {
        entryId: sampleId(`entry${affirmative}`),
        school: null,
        name: affirmative,
        side: affirmativeSide,
      },
      {
        entryId: sampleId(`entry${negative}`),
        school: null,
        name: negative,
        side: negativeSide,
      },
    ],
    judges: [
      {
        tournamentJudgeId: sampleId(`judge${judge}`),
        name: judge,
        chair: true,
      },
    ],
    findings: [...findings],
    reasons: [
      `${affirmative} and ${negative} are on the same record and have not met.`,
    ],
    alternative: null,
  };
};

const doyleSato: DrawViewFixture = {
  ...plain('doyle-sato', 'Doyle v Sato', 'R. Keane', [
    { severity: 'preference_bent', text: 'same school, preference bent' },
  ]),
  entries: [
    {
      entryId: sampleId('entryDoyle'),
      school: null,
      name: 'Doyle',
      side: negativeSide,
    },
    {
      entryId: sampleId('entrySato'),
      school: null,
      name: 'Sato',
      side: affirmativeSide,
    },
  ],
  reasons: [
    'Both have 2 wins and have not met. Doyle has been Affirmative twice, so takes Negative.',
    'Both are from Ridgeview, which is 9 of 24 entries. "Avoid same school" is a preference here, ranked below "No rematch", which is a rule.',
  ],
  alternative: {
    change: 'If you split them',
    cost: 'Sato would meet Petrov again. Four other fixtures change.',
    breaksRule: 'No rematch',
  },
};

/** The 1-win group, which the board sums up rather than lists. */
const oneWin: readonly DrawViewFixture[] = [
  plain('reid-nakata', 'Reid v Nakata', 'K. Osei'),
  plain('vance-ito', 'Vance v Ito', 'D. Marsh'),
  plain('quinn-adeyemi', 'Quinn v Adeyemi', 'H. Okonkwo'),
  plain('morales-berg', 'Morales v Berg', 'J. Pruitt'),
  plain('hale-kowalski', 'Hale v Kowalski', 'N. Varga'),
  plain('price-osei', 'Price v Osei', 'B. Achebe'),
  plain('tran-fischer', 'Tran v Fischer', 'C. Moreau'),
  plain('ward-lim', 'Ward v Lim', 'I. Tanaka'),
  plain('cole-nash', 'Cole v Nash', 'R. Lindqvist'),
  {
    fixtureId: sampleId('fixtureellisbye'),
    kind: 'bye',
    status: 'draft',
    entries: [
      {
        entryId: sampleId('entryEllis'),
        school: null,
        name: 'Ellis',
        side: null,
      },
    ],
    judges: [],
    findings: [],
    reasons: ['Ellis has the fewest wins of those without a bye.'],
    alternative: null,
  },
];

const recordGroups: DrawView['recordGroups'] = [
  {
    record: { label: 'Wins', value: { n: 3, d: 1 } },
    fixtures: [
      plain('jensen-amari', 'Jensen v Amari', 'L. Malik'),
      plain('haddad-castillo', 'Haddad v Castillo', 'P. Nguyen'),
      plain('okafor-wu', 'Okafor v Wu', 'T. Abara', [
        { severity: 'note', text: 'Wu pulled up from 2 wins' },
      ]),
    ],
  },
  {
    record: { label: 'Wins', value: { n: 2, d: 1 } },
    fixtures: [
      plain('brooks-petrov', 'Brooks v Petrov', 'E. Fontaine'),
      doyleSato,
      plain('lindqvist-mbeki', 'Lindqvist v Mbeki', 'A. Costa'),
      plain('farrow-okoye', 'Farrow v Okoye', 'S. Cho', [
        { severity: 'note', text: 'waits on round 3 ballot' },
      ]),
    ],
  },
  { record: { label: 'Wins', value: { n: 1, d: 1 } }, fixtures: [...oneWin] },
];

/** The fixtures' address slugs, which the sample's routes name them by. */
const slugs: ReadonlyMap<string, string> = new Map(
  [
    'jensen-amari',
    'haddad-castillo',
    'okafor-wu',
    'brooks-petrov',
    'doyle-sato',
    'lindqvist-mbeki',
    'farrow-okoye',
  ].map((slug) => [sampleId(`fixture${slug}`), slug]),
);

const drawView: DrawView = {
  lobbyId: sampleId('autumnopen'),
  eventId: sampleId('eventvarsity'),
  tabRound: { tabRoundId: sampleId('tabroundvarsity4'), number: 4 },
  draw: {
    drawId: sampleId('drawvarsity4v3'),
    version: 3,
    status: 'draft',
    method: 'computed',
    publishedAt: null,
    basedOn: { drawId: sampleId('drawvarsity4v2'), version: 2 },
  },
  sides: [...twoSideKeys],
  resultsThroughRound: 3,
  recordGroups,
  spareJudges: spareJudges.map((name) => ({
    tournamentJudgeId: sampleId(`judge${name}`),
    name,
  })),
  capabilities: { edit: true, publish: true },
};

/** Autumn Open's round 4 draft, while prelims run, with what the board needs beside it. */
export function sampleDrawView(
  slug: string,
  event: string,
  round: string,
  scene: SampleScene,
): {
  readonly read: DrawView;
  readonly context: Omit<DrawBoardContext, 'selectedFixtureId'>;
  readonly fixtureIdOf: (fixtureSlug: string | null) => string | null;
} | null {
  if (slug !== AUTUMN || event !== VARSITY || round !== '4') return null;
  if (!reached(scene, 'prelims') || reached(scene, 'break')) return null;
  const large = atScale(scene) ? largeDrawView(drawView) : null;
  const known: ReadonlyMap<string, string> =
    large === null ? slugs : new Map([...slugs, ...large.slugs]);
  return {
    read: large?.read ?? drawView,
    context: {
      event: varsitySwitch(scene),
      fixtureAddress: (fixtureId) =>
        hostRoutes.round(
          AUTUMN,
          VARSITY,
          '4',
          known.get(fixtureId) ?? fixtureId,
        ),
    },
    fixtureIdOf: (fixtureSlug) =>
      [...known].find(([, slug]) => slug === fixtureSlug)?.[0] ?? null,
  };
}
