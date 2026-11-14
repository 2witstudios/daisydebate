import { linkTo, sampleAction, type TabAction } from '../action';
import { hostRoutes, tabRoutes } from '../routes';
import type {
  TournamentGroup,
  TournamentPage,
  TournamentRow,
  TournamentsIndex,
  TournamentView,
} from '../tournament';
import {
  AUTUMN,
  CHAMPIONSHIP,
  LEAGUE_NAME,
  reached,
  SCRIMMAGE,
  WINTER,
} from './moment';
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

const row = (
  name: string,
  detail: string,
  action: TabAction,
): TournamentRow => ({
  name,
  detail,
  action,
});

/** Where Autumn Open stands in a list, and the one fact that says so. */
export function autumnStanding(scene: SampleScene): {
  readonly when: 'coming' | 'today' | 'finished';
  readonly fact: string;
} {
  if (!reached(scene, 'prelims'))
    return { when: 'coming', fact: 'entry closes Thursday 17:00' };
  if (reached(scene, 'finished'))
    return {
      when: 'finished',
      fact:
        scene.viewer === 'competitor'
          ? 'you finished 3rd of 48'
          : 'won by Jensen',
    };
  return {
    when: 'today',
    fact: reached(scene, 'elims')
      ? 'semifinals live'
      : reached(scene, 'break')
        ? 'the break is announced at 16:45'
        : 'Round 4 opens 15:20',
  };
}

/** What ties each sample viewer to the tournaments they are in. */
const part: Readonly<
  Record<Exclude<SampleScene['viewer'], 'visitor'>, readonly [string, string]>
> = {
  competitor: ['Varsity debate', 'Parli and Impromptu'],
  judge: ['judging Varsity debate', 'judging Parli'],
  coach: ["Hartwell's entries", "Hartwell's entries"],
  parent: ['Chidi and Ada', 'Chidi and Ada'],
  host: ['you are the host', 'you are the host'],
};

export function sampleTournamentsIndex(scene: SampleScene): TournamentsIndex {
  const autumn = autumnStanding(scene);
  const open = (slug: string, primary = false) =>
    linkTo('Open', tabRoutes.tournament(slug), primary);
  const view = (slug: string) => linkTo('View', tabRoutes.tournament(slug));
  const when = autumn.when === 'today' ? 'Today' : 'Sat 14 Nov';
  const yours =
    scene.viewer === 'visitor'
      ? []
      : [
          ...(autumn.when === 'finished'
            ? []
            : [
                row(
                  'Autumn Open',
                  `${when} · ${part[scene.viewer][0]} · ${autumn.fact}`,
                  open(AUTUMN, true),
                ),
              ]),
          row(
            'Winter Classic',
            `Sat 12 Dec · ${LEAGUE_NAME} · ${part[scene.viewer][1]}`,
            open(WINTER),
          ),
        ];
  const today =
    scene.viewer === 'visitor' && autumn.when !== 'finished'
      ? [
          row(
            'Autumn Open',
            `${when} · ${LEAGUE_NAME} · ${autumn.fact}`,
            view(AUTUMN),
          ),
        ]
      : [];
  const enter = [
    row(
      'Friday scrimmage',
      'Fri 20 Nov, 18:00 · hosted by jono · 9 of 16 places taken',
      view(SCRIMMAGE),
    ),
    ...(scene.viewer === 'visitor'
      ? []
      : [
          row(
            'Ridgeview Invitational',
            `Sat 28 Nov · ${LEAGUE_NAME} members · entry closes 25 Nov`,
            sampleAction('View'),
          ),
        ]),
  ];
  const recent = [
    ...(autumn.when === 'finished'
      ? [
          row(
            'Autumn Open',
            `14 Nov · ${LEAGUE_NAME} · ${autumn.fact}`,
            linkTo('Results', tabRoutes.tournament(AUTUMN)),
          ),
        ]
      : []),
    row(
      'September Opener',
      `12 Sept · ${LEAGUE_NAME} · ${scene.viewer === 'competitor' ? 'you finished 9th of 40' : 'won by Castillo'}`,
      sampleAction('Results'),
    ),
    row(
      'Public Beta Open',
      '3 Oct · Daisy · won by mira_k',
      sampleAction('Results'),
    ),
  ];
  const group = (
    heading: string,
    rows: readonly TournamentRow[],
    more: TabAction | null = null,
  ): TournamentGroup[] => (rows.length === 0 ? [] : [{ heading, rows, more }]);
  return {
    groups: [
      ...group("You're in", yours),
      ...group('On now', today),
      ...group('Open to enter', enter),
      ...group('Recent', recent, sampleAction('All past tournaments')),
    ],
    host:
      scene.viewer === 'visitor'
        ? null
        : linkTo('Host a tournament', hostRoutes.home),
  };
}
