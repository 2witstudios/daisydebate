import { hostRoutes, tabRoutes } from '../routes';
import type { Walk, WalkStep } from '../walk';
import {
  AUTUMN,
  CHAMPIONSHIP,
  LEAGUE,
  reached,
  SCRIMMAGE,
  VARSITY,
  WINTER,
} from './moment';
import type { SampleScene } from './scene';

const step = (label: string, href: string): WalkStep => ({ label, href });

function hostSteps(scene: SampleScene): WalkStep[] {
  const prelims = reached(scene, 'prelims');
  const drafting = prelims && !reached(scene, 'break');
  return [
    step('Host home', hostRoutes.home),
    step('League', hostRoutes.league(LEAGUE)),
    step('People and roles', hostRoutes.leaguePeople(LEAGUE)),
    step('Tournament setup', hostRoutes.setup(AUTUMN)),
    step('Pairing', hostRoutes.setup(AUTUMN, 'pairing')),
    step('Ballot settings', hostRoutes.ballot(AUTUMN, VARSITY)),
    step('Resolutions', hostRoutes.resolutions(AUTUMN, VARSITY)),
    step('Events and schedule', hostRoutes.events(AUTUMN)),
    step('Entries', hostRoutes.entries(AUTUMN)),
    step('Judges', hostRoutes.judges(AUTUMN)),
    ...(prelims
      ? [
          step(
            drafting ? 'Round 3, running' : 'Round 3',
            hostRoutes.round(AUTUMN, VARSITY, '3'),
          ),
        ]
      : []),
    ...(drafting
      ? [
          step('Round 4 draft draw', hostRoutes.round(AUTUMN, VARSITY, '4')),
          step(
            'One fixture: why, and what an edit costs',
            hostRoutes.round(AUTUMN, VARSITY, '4', 'doyle-sato'),
          ),
        ]
      : []),
    ...(prelims
      ? [step('Standings and break', hostRoutes.standings(AUTUMN))]
      : []),
    ...(reached(scene, 'elims')
      ? [step('Bracket, certify and release', hostRoutes.results(AUTUMN))]
      : []),
    step('Several events: events and schedule', hostRoutes.events(WINTER)),
    ...(prelims
      ? [step('Several events: one time slot', hostRoutes.slot(WINTER, '1200'))]
      : []),
  ];
}

const rooms = [
  step('Event Room: a panel', tabRoutes.room('semifinal-room-1')),
  step('Event Room: a speech section', tabRoutes.room('impromptu-section-c')),
  step('Event Room: four teams', tabRoutes.room('championship-round-2-room-4')),
  step('Open Room', tabRoutes.room('homework-open')),
];

const ballots = [
  step('Ballot: points and a winner', tabRoutes.ballot('semifinal-room-1')),
  step(
    'Ballot: a double loss and feedback',
    tabRoutes.ballot('round-4-room-5'),
  ),
  step('Ballot: ranks', tabRoutes.ballot('impromptu-section-c')),
  step(
    'Ballot: a criteria grid and ranks',
    tabRoutes.ballot('championship-round-2-room-4'),
  ),
];

function steps(scene: SampleScene): WalkStep[] {
  const tournaments = [
    step('Tournaments', tabRoutes.tournaments),
    step('Autumn Open', tabRoutes.tournament(AUTUMN)),
  ];
  const posted = reached(scene, 'prelims')
    ? [
        step('Round 3', tabRoutes.round(AUTUMN, VARSITY, '3')),
        step('Standings', tabRoutes.standings(AUTUMN)),
        step('Bracket', tabRoutes.bracket(AUTUMN)),
      ]
    : [];
  const league = [
    step('League lobby', tabRoutes.league(LEAGUE)),
    step('League ladder', tabRoutes.league(LEAGUE, 'ladder')),
    step('Season standings', tabRoutes.league(LEAGUE, 'season')),
    step('New room in the league lobby', tabRoutes.newLeagueRoom(LEAGUE)),
  ];
  switch (scene.viewer) {
    case 'host':
      return [
        ...hostSteps(scene),
        step('The participant side', tabRoutes.tournament(AUTUMN)),
      ];
    case 'visitor':
      return [
        ...tournaments,
        ...posted,
        step('Before a tournament', tabRoutes.tournament(SCRIMMAGE)),
      ];
    case 'competitor':
      return [
        ...tournaments,
        ...posted,
        step('Before a tournament', tabRoutes.tournament(SCRIMMAGE)),
        step('Entered in three events', tabRoutes.tournament(WINTER)),
        step('A four-team tournament', tabRoutes.tournament(CHAMPIONSHIP)),
        ...rooms,
        step('Speech section, live', tabRoutes.liveRoom('impromptu-section-c')),
        ...league,
      ];
    case 'judge':
      return [
        ...tournaments,
        ...posted,
        ...rooms.slice(0, 3),
        ...ballots,
        ...league,
      ];
    case 'coach':
      return [
        ...tournaments,
        step("A school's entries", tabRoutes.entries(WINTER)),
        step('Entries at Autumn Open', tabRoutes.entries(AUTUMN)),
        ...posted,
        ...league,
      ];
    case 'parent':
      return [
        ...tournaments,
        step("A family's entries", tabRoutes.entries(AUTUMN)),
        step("A minor's account", tabRoutes.minor('ada')),
        step(
          'Allow a tournament',
          tabRoutes.allowTournament('ada', 'capital-city-classic'),
        ),
        ...posted,
        ...league,
      ];
  }
}

export const sampleWalk = (scene: SampleScene): Walk => ({
  scene,
  steps: steps(scene),
});
