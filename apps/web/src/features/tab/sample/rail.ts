import { linkTo, sampleAction, type TabAction } from '../action';
import { hostRoutes } from '../routes';
import type { RailItem, RailStanding, TimelineRail } from '../tournament';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY, WINTER } from './moment';
import type { SampleScene } from './scene';

/** A count, a start time or a word that asks nothing of the host. */
export const said = (text: string): RailStanding => ({ kind: 'note', text });
export const done: RailStanding = { kind: 'done' };
const needsYou = (count: number): RailStanding => ({
  kind: 'needs_you',
  count,
});

const stop = (
  id: string,
  label: string,
  standing: RailStanding | null,
  action: TabAction | null,
  time: string | null = null,
): RailItem => ({ id, label, time, standing, action });

const to = (label: string, href: string) => linkTo(label, href);

function autumnRail(scene: SampleScene): TimelineRail {
  const round = (n: string) =>
    to(`Round ${n}`, hostRoutes.round(AUTUMN, VARSITY, n));
  const setup = to('Setup', hostRoutes.setup(AUTUMN));
  const events = to('Events and schedule', hostRoutes.events(AUTUMN));
  const entries = to('Entries', hostRoutes.entries(AUTUMN));
  const standings = to('Break', hostRoutes.standings(AUTUMN));
  const results = to('Results', hostRoutes.results(AUTUMN));
  const people = stop(
    'people',
    'People',
    null,
    to('People', hostRoutes.people(AUTUMN)),
  );
  const head = (setupStanding: RailStanding, entryCount: number) => [
    stop('setup', 'Setup', setupStanding, setup),
    stop('events', 'Events and schedule', said('3'), events),
    stop('entries', 'Entries', said(String(entryCount)), entries),
  ];
  const foot = [
    stop(
      'standings',
      'Standings',
      null,
      to('Standings', hostRoutes.standings(AUTUMN)),
    ),
    people,
  ];
  const title = {
    title: 'Autumn Open',
    subtitle: `${LEAGUE_NAME} · 14 Nov`,
    heading: null,
    footHeading: null,
  };
  if (!reached(scene, 'prelims'))
    return {
      ...title,
      items: [
        ...head({ kind: 'unfinished', count: 2 }, 31),
        stop('round-1', 'Round 1', said('10:00'), null),
        stop('round-2', 'Round 2', said('11:40'), null),
        stop('round-3', 'Round 3', said('13:20'), null),
        stop('round-4', 'Round 4', said('15:00'), null),
        stop('break', 'Break', said('16:45'), null),
        stop('results', 'Results', null, null),
      ],
      foot: [people],
    };
  if (!reached(scene, 'break'))
    return {
      ...title,
      items: [
        ...head(done, 48),
        stop('round-1', 'Round 1', done, round('1')),
        stop('round-2', 'Round 2', done, round('2')),
        stop('round-3', 'Round 3', needsYou(2), round('3')),
        stop('round-4', 'Round 4', { kind: 'draft' }, round('4')),
        stop('break', 'Break', null, standings),
        // Results open once the break is announced and there is a bracket.
        stop('results', 'Results', null, null),
      ],
      foot,
    };
  const prelims = stop('round-4', 'Rounds 1 to 4', done, round('4'));
  if (!reached(scene, 'elims'))
    return {
      ...title,
      items: [
        ...head(done, 48),
        prelims,
        stop('break', 'Break', { kind: 'ready' }, standings),
        // Results open once the break is announced and there is a bracket.
        stop('results', 'Results', null, null),
      ],
      foot,
    };
  const finished = reached(scene, 'finished');
  return {
    ...title,
    items: [
      ...head(done, 48),
      prelims,
      stop('break', 'Break', said('announced'), standings),
      stop('quarterfinals', 'Quarterfinals', done, results),
      stop(
        'semifinals',
        'Semifinals',
        finished ? done : { kind: 'live' },
        results,
      ),
      stop('final', 'Final', finished ? done : null, results),
      stop('results', 'Results', finished ? said('certified') : null, results),
    ],
    foot,
  };
}

const winterSlots = [
  ['0900', '09:00', 'Debate round 1'],
  ['1030', '10:30', 'Speech A round 1'],
  ['1200', '12:00', 'Debate round 2'],
  ['1330', '13:30', 'Speech B round 1'],
  ['1500', '15:00', 'Debate round 3'],
  ['1630', '16:30', 'Speech finals'],
  ['1800', '18:00', 'Debate breaks'],
] as const;

const winterStandings: Readonly<Record<string, RailStanding>> = {
  '0900': done,
  '1030': done,
  '1200': needsYou(3),
  '1330': said('drawn'),
};

function winterRail(scene: SampleScene): TimelineRail {
  const running = reached(scene, 'prelims');
  return {
    title: 'Winter Classic',
    subtitle: `${LEAGUE_NAME} · 12 Dec`,
    heading: null,
    footHeading: null,
    items: [
      stop('setup', 'Setup', done, sampleAction('Setup')),
      stop(
        'events',
        'Events and schedule',
        said('8'),
        to('Events and schedule', hostRoutes.events(WINTER)),
      ),
      stop(
        'entries',
        'Entries',
        said(running ? '213' : 'opens 1 Dec'),
        sampleAction('Entries'),
      ),
      ...winterSlots.map(([id, time, label]) =>
        stop(
          `slot-${id}`,
          label,
          running ? (winterStandings[id] ?? null) : null,
          id === '1200' && running
            ? to(label, hostRoutes.slot(WINTER, id))
            : running
              ? sampleAction(label)
              : null,
          time,
        ),
      ),
      stop(
        'results',
        'Results',
        null,
        running ? sampleAction('Results') : null,
      ),
    ],
    foot: [
      stop('standings', 'Standings', null, sampleAction('Standings')),
      stop('people', 'People', null, to('People', hostRoutes.people(WINTER))),
    ],
  };
}

export function sampleTimelineRail(
  slug: string,
  scene: SampleScene,
): TimelineRail | null {
  if (slug === AUTUMN) return autumnRail(scene);
  if (slug === WINTER) return winterRail(scene);
  return null;
}
