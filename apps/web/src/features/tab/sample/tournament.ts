import { linkTo, sampleAction } from '../action';
import { tabRoutes } from '../routes';
import type {
  TournamentPage,
  TournamentSummary,
  TournamentView,
} from '../tournament';
import { AUTUMN, CHAMPIONSHIP, LEAGUE_NAME, SCRIMMAGE, WINTER } from './moment';
import { closed, posting } from './posting';
import type { SampleScene } from './scene';
import { autumnPage } from './tournament-autumn';
import { winterPage } from './tournament-winter';

const scrimmage: TournamentPage = {
  kind: 'before',
  name: 'Friday scrimmage',
  lede: 'Friday 20 Nov, 18:00 · online · hosted by jono',
  places: '9 of 16 places taken',
  closes: 'Entry closes Friday 17:00 · open to anyone',
  enter: sampleAction('Enter', true),
  terms: [
    {
      title: 'Single elimination',
      detail:
        'Seeded by your Daisy rating when entry closes. Four rounds, about 35 minutes each.',
    },
    {
      title: 'One-on-one, limited prep',
      detail:
        'You strike from five resolutions in the room, then 20 minutes to prepare.',
    },
    {
      title: 'Judged by people in the bracket',
      detail:
        "If you're knocked out you may be asked to judge a later round. Three judges in the final.",
    },
    {
      title: 'Recorded',
      detail:
        'Rounds are recorded and released to the people in them. Results are public.',
    },
    {
      title: "Doesn't change your rating",
      detail: 'Tournament results stay in the tournament.',
    },
  ],
  entered:
    'mira_k · 1688, tobias · 1640, devon.w · 1611, r_haddad · 1570 and 5 more',
};

function championshipPage(
  view: TournamentView,
  scene: SampleScene,
): TournamentPage {
  const selected = view.kind === 'standings' ? 'standings' : 'round';
  return {
    kind: 'rounds',
    name: 'Championship',
    lede: 'British Parliamentary',
    headerAction: null,
    yourRoom:
      scene.viewer === 'competitor'
        ? {
            eyebrow: 'Your room · Round 2 · opens in 6 minutes',
            title: 'Opening Opposition with Okoye',
            detail: 'Room 4 · three judges · Malik chairs',
            action: linkTo(
              'Go to room',
              tabRoutes.room('championship-round-2-room-4'),
              true,
            ),
          }
        : null,
    tabs: [
      {
        id: 'round',
        label: 'Round 2',
        href: tabRoutes.round(CHAMPIONSHIP, 'british-parliamentary', '2'),
        selected: selected === 'round',
      },
      {
        id: 'standings',
        label: 'Standings',
        href: tabRoutes.standings(CHAMPIONSHIP),
        selected: selected === 'standings',
      },
    ],
    panel:
      view.kind === 'standings' || view.kind === 'bracket'
        ? closed('Results appear here when the break is announced.')
        : {
            kind: 'posting',
            heading: 'Round 2 · opens 14:50 · 6 rooms',
            rows: [
              posting(
                'Hartwell A, Ridgeview B, Lakeside A, Ridgeview C',
                'Room 4 · Malik chairs · Nguyen, Costa',
                linkTo('Room', tabRoutes.room('championship-round-2-room-4')),
              ),
              posting(
                'Lakeside B, Hartwell B, Ridgeview A, Okafor family',
                'Room 5 · Abara chairs · Keane, Shah',
              ),
            ],
            more: 4,
          },
    note: null,
    noteAction: null,
    signIn: null,
  };
}

export function sampleTournamentPage(
  slug: string,
  view: TournamentView,
  scene: SampleScene,
): TournamentPage | null {
  if (slug === AUTUMN) return autumnPage(view, scene);
  if (slug === WINTER) return winterPage(view, scene);
  if (slug === CHAMPIONSHIP) return championshipPage(view, scene);
  if (slug === SCRIMMAGE && view.kind === 'home') return scrimmage;
  return null;
}

export const sampleTournaments: readonly TournamentSummary[] = [
  {
    slug: AUTUMN,
    name: 'Autumn Open',
    detail: `${LEAGUE_NAME} · Saturday 14 Nov`,
  },
  {
    slug: SCRIMMAGE,
    name: 'Friday scrimmage',
    detail: 'Friday 20 Nov · hosted by jono',
  },
  {
    slug: WINTER,
    name: 'Winter Classic',
    detail: `${LEAGUE_NAME} · Saturday 12 Dec`,
  },
  {
    slug: CHAMPIONSHIP,
    name: 'Championship',
    detail: `${LEAGUE_NAME} · March`,
  },
];
