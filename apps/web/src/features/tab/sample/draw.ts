import { choice, sampleAction } from '../action';
import type {
  DraftFixture,
  DrawBoard,
  FixtureDetail,
  FixtureFlag,
} from '../draw';
import { hostRoutes } from '../routes';
import { AUTUMN, reached, VARSITY, varsitySwitch } from './moment';
import type { SampleScene } from './scene';

type Draft = {
  readonly id: string;
  readonly title: string;
  readonly judges: string;
  readonly flags: readonly FixtureFlag[];
  readonly detail: FixtureDetail | null;
};

const plain = (
  id: string,
  title: string,
  judge: string,
  flags: readonly FixtureFlag[] = [],
): Draft => {
  const [affirmative = '', negative = ''] = title.split(' v ');
  return {
    id,
    title,
    judges: `Judge ${judge}`,
    flags,
    detail: {
      title,
      why: [
        `${affirmative} and ${negative} are on the same record and have not met.`,
      ],
      seats: [
        choice('Affirmative', [affirmative, negative]),
        choice('Negative', [negative, affirmative]),
        choice('Judge', [judge, 'A. Shah', 'M. Reyes']),
      ],
      alternative: null,
    },
  };
};

const doyleSato: Draft = {
  ...plain('doyle-sato', 'Doyle v Sato', 'R. Keane', [
    { severity: 'preference_bent', text: 'same school, preference bent' },
  ]),
  detail: {
    title: 'Doyle v Sato',
    why: [
      'Both have 2 wins and have not met. Doyle has been Affirmative twice, so takes Negative.',
      'Both are from Ridgeview, which is 9 of 24 entries. "Avoid same school" is a preference here, ranked below "No rematch", which is a rule.',
    ],
    seats: [
      choice('Affirmative', ['Sato', 'Doyle']),
      choice('Negative', ['Doyle', 'Sato']),
      choice('Judge', ['R. Keane', 'A. Shah', 'M. Reyes']),
    ],
    alternative: {
      heading: 'If you split them',
      cost: 'Sato would meet Petrov again. Four other fixtures change.',
      breaksRule: 'No rematch',
      show: sampleAction('Show that draw'),
    },
  },
};

const groups: readonly {
  readonly record: string;
  readonly drafts: readonly Draft[];
}[] = [
  {
    record: '3 wins',
    drafts: [
      plain('jensen-amari', 'Jensen v Amari', 'L. Malik'),
      plain('haddad-castillo', 'Haddad v Castillo', 'P. Nguyen'),
      plain('okafor-wu', 'Okafor v Wu', 'T. Abara', [
        { severity: 'note', text: 'Wu pulled up from 2 wins' },
      ]),
    ],
  },
  {
    record: '2 wins',
    drafts: [
      plain('brooks-petrov', 'Brooks v Petrov', 'E. Fontaine'),
      doyleSato,
      plain('lindqvist-mbeki', 'Lindqvist v Mbeki', 'A. Costa'),
      plain('farrow-okoye', 'Farrow v Okoye', 'S. Cho', [
        { severity: 'note', text: 'waits on round 3 ballot' },
      ]),
    ],
  },
];

export function sampleDrawBoard(
  slug: string,
  event: string,
  round: string,
  fixture: string | null,
  scene: SampleScene,
): DrawBoard | null {
  if (slug !== AUTUMN || event !== VARSITY || round !== '4') return null;
  if (!reached(scene, 'prelims') || reached(scene, 'break')) return null;
  const drafts = groups.flatMap((group) => group.drafts);
  const chosen = drafts.find((draft) => draft.id === fixture) ?? null;
  const row = (draft: Draft): DraftFixture => ({
    id: draft.id,
    title: draft.title,
    judges: draft.judges,
    flags: draft.flags,
    href: hostRoutes.round(AUTUMN, VARSITY, '4', draft.id),
    selected: draft.id === chosen?.id,
  });
  return {
    event: varsitySwitch,
    title: 'Round 4 draw',
    version: 3,
    basis: 'from results through round 3',
    rulesBroken: 0,
    preferencesBent: 1,
    again: sampleAction('Draw again'),
    publish: sampleAction('Publish round 4', true),
    groups: groups.map((group) => ({
      record: group.record,
      fixtures: group.drafts.map(row),
    })),
    rest: '1 win · 9 more fixtures · Ellis has the bye',
    back: sampleAction('Go back to draft 2'),
    selected: chosen?.detail ?? null,
  };
}
