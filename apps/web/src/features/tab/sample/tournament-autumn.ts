import { linkTo, sampleAction } from '../action';
import { tabRoutes } from '../routes';
import type {
  PinnedRoom,
  TournamentPage,
  TournamentPanel,
  TournamentTab,
  TournamentView,
} from '../tournament';
import { AUTUMN, LEAGUE_NAME, postedRounds, reached, VARSITY } from './moment';
import { closed, posting } from './posting';
import { sampleBracket } from './results';
import type { SampleScene } from './scene';
import { sampleStandings } from './standings';

const roundFour = (visitor: boolean): TournamentPanel => ({
  kind: 'posting',
  heading: visitor ? 'Round 4 · started 15:20' : 'Opens 15:20 · 12 rooms',
  rows: [
    posting('Jensen v Amari', 'Room 1 · Judge L. Malik'),
    posting('Haddad v Castillo', 'Room 2 · Judge P. Nguyen'),
    // The public sees a competitor under 16 by initials.
    posting(visitor ? 'C. O. v Wu' : 'Okafor v Wu', 'Room 3 · Judge T. Abara'),
    posting('Brooks v Petrov', 'Room 4 · Judge E. Fontaine'),
    ...(visitor ? [posting('Doyle v Sato', 'Room 5 · Judge R. Keane')] : []),
  ].map((row) => (visitor ? { ...row, action: null } : row)),
  more: visitor ? 7 : 0,
});

const roundThree = (visitor: boolean): TournamentPanel => ({
  kind: 'posting',
  heading: 'Round 3 · started 13:40',
  rows: [
    posting('Farrow v Okoye', 'Room 6 · Judge M. Reyes'),
    posting('Brooks v Petrov', 'Room 8 · Judge S. Cho'),
    posting('Reid v Nakata', 'Room 10 · Judge A. Shah'),
    posting(visitor ? 'C. O. v Wu' : 'Okafor v Wu', 'Room 3 · Judge T. Abara'),
    posting('Jensen v Amari', 'Room 1 · Judge L. Malik'),
  ].map((row) => (visitor ? { ...row, action: null } : row)),
  more: 19,
});

function autumnPanel(
  view: TournamentView,
  scene: SampleScene,
): TournamentPanel {
  const visitor = scene.viewer === 'visitor';
  const announced = reached(scene, 'elims');
  switch (view.kind) {
    case 'home':
      return roundFour(visitor);
    case 'round':
      return view.round === '3' ? roundThree(visitor) : roundFour(visitor);
    case 'standings': {
      const table = sampleStandings(AUTUMN, view.event, {
        ...scene,
        viewer: 'visitor',
      });
      return table === null || (visitor && !announced)
        ? closed('Results appear here when the break is announced.')
        : { kind: 'standings', table };
    }
    case 'bracket': {
      const bracket = sampleBracket(AUTUMN, view.event, scene);
      return bracket === null
        ? closed('The bracket appears when the break is announced.')
        : { kind: 'bracket', bracket };
    }
  }
}

function autumnTabs(view: TournamentView, scene: SampleScene): TournamentTab[] {
  const visitor = scene.viewer === 'visitor';
  const round =
    view.kind === 'home' ? '4' : view.kind === 'round' ? view.round : null;
  const tab = (id: string, label: string, href: string): TournamentTab => ({
    id,
    label,
    href,
    selected: id === (round ?? view.kind),
  });
  return [
    tab('3', 'Round 3', tabRoutes.round(AUTUMN, VARSITY, '3')),
    tab('4', 'Round 4', tabRoutes.round(AUTUMN, VARSITY, '4')),
    ...(visitor || reached(scene, 'elims')
      ? [tab('bracket', 'Bracket', tabRoutes.bracket(AUTUMN))]
      : []),
    tab(
      'standings',
      visitor || reached(scene, 'elims') ? 'Standings' : 'Break',
      tabRoutes.standings(AUTUMN),
    ),
  ];
}

function autumnRoom(scene: SampleScene): PinnedRoom | null {
  const semifinal = reached(scene, 'elims') && !reached(scene, 'finished');
  if (reached(scene, 'break') && !semifinal) return null;
  if (scene.viewer === 'competitor')
    return semifinal
      ? {
          eyebrow: 'Your room · Semifinal · opens in 6 minutes',
          title: 'Jensen v You',
          detail: 'Room 1 · you are Negative · three judges',
          action: linkTo(
            'Go to room',
            tabRoutes.room('semifinal-room-1'),
            true,
          ),
        }
      : {
          eyebrow: 'Your room · Round 4 · opens 15:20',
          title: 'Sato v You',
          detail: 'Room 5 · you are Negative · Judge R. Keane',
          action: linkTo('Go to room', tabRoutes.room('round-4-room-5'), true),
        };
  if (scene.viewer === 'judge')
    return semifinal
      ? {
          eyebrow: 'You are judging · Semifinal · Room 1',
          title: 'Jensen v Doyle',
          detail: '1 of 3 judges · the speeches have ended',
          action: linkTo(
            'Open your ballot',
            tabRoutes.ballot('semifinal-room-1'),
            true,
          ),
        }
      : {
          eyebrow: 'You are judging · Round 4 · opens 15:20',
          title: 'Sato v Doyle',
          detail: 'Room 5 · you are the only judge',
          action: linkTo('Go to room', tabRoutes.room('round-4-room-5'), true),
        };
  return null;
}

const autumnAdult = (scene: SampleScene): TournamentPage => {
  const parent = scene.viewer === 'parent';
  const read = sampleAction('Read');
  return {
    kind: 'adult',
    name: 'Autumn Open',
    lede: parent ? "Your children's entries" : "Hartwell's entries",
    now: parent
      ? [
          {
            name: 'Chidi',
            facts: 'Varsity debate · 3-1',
            detail: 'Quarterfinal v Haddad · Room 4 · speaking now',
            action: sampleAction('Watch', true),
          },
          {
            name: 'Ada',
            facts: 'Impromptu',
            detail: 'Round 3 · Section B · opens 17:10',
            action: sampleAction('Details'),
          },
        ]
      : [
          {
            name: 'Jensen',
            facts: 'Varsity debate · 4-0',
            detail: 'Quarterfinal v Sato · Room 1 · speaking now',
            action: sampleAction('Watch', true),
          },
          {
            name: 'Haddad',
            facts: 'Varsity debate · 3-1',
            detail: 'Quarterfinal v Okafor · Room 4 · speaking now',
            action: sampleAction('Watch'),
          },
        ],
    ballots: parent
      ? [
          {
            title: 'Chidi · Round 4 · won',
            detail: '28.5 points · Judge T. Abara',
            action: read,
          },
          {
            title: 'Chidi · Round 3 · lost',
            detail: '27 points · Judge S. Cho',
            action: read,
          },
          {
            title: 'Ada · Round 2 · ranked 2nd of 6',
            detail: 'Two judges',
            action: read,
          },
        ]
      : [
          {
            title: 'Jensen · Round 4 · won',
            detail: '29 points · Judge L. Malik',
            action: read,
          },
          {
            title: 'Haddad · Round 4 · won',
            detail: '28 points · Judge P. Nguyen',
            action: read,
          },
        ],
    ballotsNote: parent
      ? 'Chidi and Ada see their results now, and scores and feedback after prelims are certified.'
      : 'Your debaters see their results now, and scores and feedback after prelims are certified.',
    judging: parent
      ? {
          eyebrow: "You're judging at 17:10",
          title: 'Novice debate · Room 9',
          detail: 'Never a room with Chidi, Ada or their club.',
          action: sampleAction('Open'),
        }
      : null,
    manage: parent
      ? linkTo("Manage Chidi's and Ada's accounts", tabRoutes.minor('ada'))
      : linkTo("Manage Hartwell's entries", tabRoutes.entries(AUTUMN)),
  };
};

const autumnBefore = (scene: SampleScene): TournamentPage => ({
  kind: 'before',
  name: 'Autumn Open',
  lede: `Saturday 14 Nov, 10:00 · online · ${LEAGUE_NAME}`,
  places: '31 of 48 places taken',
  closes:
    'Entry closes Thursday 17:00 · schools and families the league has added',
  enter:
    scene.viewer === 'coach' || scene.viewer === 'parent'
      ? linkTo('Manage entries', tabRoutes.entries(AUTUMN), true)
      : sampleAction('Enter', true),
  terms: [
    {
      title: 'Four rounds, then the top 8',
      detail:
        'Paired by record after a seeded first round. About 40 minutes each.',
    },
    {
      title: 'One-on-one, limited prep',
      detail:
        'You strike from five resolutions in the room, then 20 minutes to prepare.',
    },
    {
      title: 'One judge a room',
      detail: 'Three in elimination rounds and five in the final.',
    },
    {
      title: 'Recorded',
      detail:
        'Rounds are recorded and released to the people in them. Results are public.',
    },
    {
      title: 'Counts for the season',
      detail: `${LEAGUE_NAME} has been asked to count it.`,
    },
  ],
  entered: 'Ridgeview · 9, Hartwell · 7, Okafor family · 2 and 5 more schools',
});

export function autumnPage(
  view: TournamentView,
  scene: SampleScene,
): TournamentPage | null {
  if (
    view.kind === 'round' &&
    (view.event !== VARSITY || !postedRounds.includes(view.round))
  )
    return null;
  if (!reached(scene, 'prelims')) return autumnBefore(scene);
  if (
    (scene.viewer === 'parent' || scene.viewer === 'coach') &&
    view.kind === 'home'
  )
    return autumnAdult(scene);
  const visitor = scene.viewer === 'visitor';
  const finished = reached(scene, 'finished');
  return {
    kind: 'rounds',
    name: 'Autumn Open',
    lede: visitor
      ? `${LEAGUE_NAME} · Saturday 14 Nov · Varsity debate`
      : scene.viewer === 'competitor'
        ? `Varsity debate · you are ${reached(scene, 'break') ? '3-1' : '2-1'}`
        : 'Varsity debate',
    headerAction: visitor
      ? null
      : linkTo('Standings', tabRoutes.standings(AUTUMN)),
    yourRoom: autumnRoom(scene),
    tabs: autumnTabs(view, scene),
    panel: autumnPanel(view, scene),
    note: visitor
      ? `${reached(scene, 'elims') ? '' : 'Results appear here when the break is announced. '}Competitors under 16 are shown by initials. Video is for people taking part.`
      : finished
        ? 'Certified at 19:40. Scores and feedback are open to you.'
        : scene.viewer === 'competitor'
          ? 'Round 3: you won. Scores and feedback open after prelims.'
          : null,
    noteAction:
      scene.viewer === 'competitor' && !finished
        ? sampleAction('Watch it back')
        : null,
    signIn: visitor
      ? linkTo('Taking part? Sign in to see your room', '/sign-in', true)
      : null,
  };
}
