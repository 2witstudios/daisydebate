import { linkTo, sampleAction } from '../action';
import type { HostHome, People } from '../organization';
import type { TimelineRail } from '../tournament';
import { hostRoutes } from '../routes';
import { AUTUMN, LEAGUE, LEAGUE_NAME, reached, WINTER } from './moment';
import { done, said } from './rail';
import type { SampleScene } from './scene';

export function sampleHostHome(scene: SampleScene): HostHome {
  const before = !reached(scene, 'prelims');
  const finished = reached(scene, 'finished');
  const autumn = {
    name: 'Autumn Open',
    owner: LEAGUE_NAME,
    detail: before
      ? '14 Nov · setup has 2 to finish · 31 entered · you are Director'
      : finished
        ? 'Certified today · results sent to the league'
        : 'Round 3 of 4 · 2 things need you · you are Director',
    action: linkTo(
      finished ? 'Results' : 'Open',
      hostRoutes.tournament(AUTUMN),
      !finished,
    ),
  };
  const coming = [
    {
      name: 'Friday scrimmage',
      owner: 'hosted by you',
      detail:
        '20 Nov · open entry, 16 places, single elimination seeded by Daisy rating · 9 entered',
      action: sampleAction('Open'),
    },
    {
      name: 'Winter Classic',
      owner: LEAGUE_NAME,
      detail:
        '12 Dec · setup not finished · entries not open · you are Tab staff',
      action: linkTo('Open', hostRoutes.tournament(WINTER)),
    },
  ];
  const opener = {
    name: 'September Opener',
    owner: LEAGUE_NAME,
    detail: 'Certified 19 Sept · results sent to the league',
    action: sampleAction('Results'),
  };
  return {
    create: sampleAction('New tournament', true),
    groups: [
      ...(before || finished
        ? []
        : [{ heading: 'Running now', tournaments: [autumn] }]),
      {
        heading: 'Coming up',
        tournaments: before ? [autumn, ...coming] : coming,
      },
      {
        heading: 'Finished',
        tournaments: finished ? [autumn, opener] : [opener],
      },
    ],
    cards: [
      {
        title: LEAGUE_NAME,
        detail:
          'You own it. 14 schools, 212 members. 1 sanction request is waiting.',
        action: linkTo('Open the league', hostRoutes.league(LEAGUE)),
      },
      {
        title: 'Hosting plan',
        detail: `League plan, paid by ${LEAGUE_NAME}. Covers the league's tournaments and the ones you host yourself.`,
        action: sampleAction('Manage plan'),
      },
    ],
  };
}

const permissions = [
  'Change a draft draw',
  'Run rooms: reseat, replace a judge, restart, forfeit',
  'Enter and correct results',
  'See ballots before release',
  'Manage entries and judges',
  'Message participants',
  'Publish a draw',
  'Release and certify results',
  'See resolutions before release',
  'Change tournament setup',
  'Manage roles and people',
  'Manage the league',
] as const;

/** Daisy's preset roles, highest first, with the permissions each allows. */
const presets = [
  { id: 'director', name: 'Director', allows: permissions.slice(0, 11) },
  { id: 'tab-staff', name: 'Tab staff', allows: permissions.slice(0, 6) },
  { id: 'topic-committee', name: 'Topic committee', allows: [permissions[8]] },
  {
    id: 'room-helper',
    name: 'Room helper',
    allows: [permissions[1], permissions[5]],
  },
] as const;

export function samplePeople(
  role: string | null,
  basePath: string,
  _scene: SampleScene,
): People {
  const chosen = presets.find((preset) => preset.id === role) ?? presets[1];
  const allowed: readonly string[] = chosen.allows;
  const change = sampleAction('Change');
  return {
    give: sampleAction('Give someone a role', true),
    people: [
      {
        name: 'You',
        detail: `Owner of ${LEAGUE_NAME} · can't be removed by anyone else`,
        conflict: null,
        owner: true,
        action: null,
      },
      {
        name: 'Priya Lindqvist',
        detail: 'Director · whole league',
        conflict: null,
        owner: false,
        action: change,
      },
      {
        name: 'Dana Abara',
        detail: 'Tab staff · Autumn Open only · ends Sunday',
        conflict: 'Coaches at Hartwell, which has 7 entries here',
        owner: false,
        action: change,
      },
      {
        name: 'Sam Reyes',
        detail: 'Tab staff · Autumn Open only · ends Sunday',
        conflict: null,
        owner: false,
        action: change,
      },
      {
        name: 'Lena Cho',
        detail: 'Topic committee · whole league',
        conflict: null,
        owner: false,
        action: change,
      },
      {
        name: 'Marcus Bello',
        detail: 'Invited as Room helper · Autumn Open only · not yet accepted',
        conflict: null,
        owner: false,
        action: sampleAction('Cancel invite'),
      },
    ],
    roles: presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      href: `${basePath}?role=${preset.id}`,
      selected: preset.id === chosen.id,
    })),
    role: {
      name: chosen.name,
      permissions: permissions.map((label) => ({
        label,
        allowed: allowed.includes(label),
      })),
      conflictRule:
        "Whatever a role allows, anyone connected to a room is handled by that tournament's setting. At Autumn Open a second person confirms.",
    },
  };
}

/** Host home's rail: what is coming up, then the leagues the viewer runs. */
export function sampleHostRail(scene: SampleScene): TimelineRail {
  return {
    title: 'Host',
    subtitle: null,
    heading: 'Coming up',
    items: [
      {
        id: AUTUMN,
        label: 'Autumn Open',
        time: null,
        standing: reached(scene, 'finished') ? done : said('today'),
        action: linkTo('Autumn Open', hostRoutes.tournament(AUTUMN)),
      },
      {
        id: 'friday-scrimmage',
        label: 'Friday scrimmage',
        time: null,
        standing: said('20 Nov'),
        action: sampleAction('Friday scrimmage'),
      },
      {
        id: WINTER,
        label: 'Winter Classic',
        time: null,
        standing: said('12 Dec'),
        action: linkTo('Winter Classic', hostRoutes.tournament(WINTER)),
      },
    ],
    footHeading: 'Leagues',
    foot: [
      {
        id: LEAGUE,
        label: LEAGUE_NAME,
        time: null,
        standing: null,
        action: linkTo(LEAGUE_NAME, hostRoutes.league(LEAGUE)),
      },
    ],
  };
}
