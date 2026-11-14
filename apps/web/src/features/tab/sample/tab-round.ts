import { linkTo, sampleAction, type TabAction } from '../action';
import { hostRoutes, tabRoutes } from '../routes';
import type {
  AttentionGroup,
  AttentionRoom,
  RunningRound,
  TimeSlot,
} from '../tab-round';
import { AUTUMN, reached, VARSITY, varsitySwitch, WINTER } from './moment';
import type { SampleScene } from './scene';

const room = (
  title: string,
  detail: string,
  action: TabAction,
): AttentionRoom => ({ title, detail, action });

const result = sampleAction('Result');

const finished: Readonly<Record<string, readonly AttentionRoom[]>> = {
  '1': [
    room(
      'Jensen v Brooks',
      'Room 1 · Judge L. Malik · Jensen won 28.5 to 27.5',
      result,
    ),
    room(
      'Castillo v Petrov',
      'Room 2 · Judge P. Nguyen · Castillo won 28 to 27',
      result,
    ),
    room(
      'Okafor v Ellis',
      'Room 3 · Judge T. Abara · Okafor won 29 to 26.5',
      result,
    ),
  ],
  '2': [
    room(
      'Jensen v Wu',
      'Room 1 · Judge A. Costa · Jensen won 29 to 28',
      result,
    ),
    room(
      'Reid v Nakata',
      'Room 7 · Judge S. Cho · Nakata won 28 to 27.5 · corrected',
      result,
    ),
    room(
      'Castillo v Doyle',
      'Room 2 · Judge R. Keane · Castillo won 28.5 to 28',
      result,
    ),
  ],
  '3': [
    room(
      'Jensen v Amari',
      'Room 1 · Judge L. Malik · Jensen won 28.5 to 27',
      result,
    ),
    room(
      'Haddad v Castillo',
      'Room 2 · Judge P. Nguyen · Castillo won 29 to 28',
      result,
    ),
    room(
      'Ellis',
      "Bye · counted as a win under the tournament's bye rule",
      result,
    ),
  ],
  '4': [
    room(
      'Jensen v Amari',
      'Room 1 · Judge L. Malik · Jensen won 29 to 27.5',
      result,
    ),
    room(
      'Haddad v Castillo',
      'Room 2 · Judge P. Nguyen · Castillo won 28.5 to 28',
      result,
    ),
    room(
      'Doyle v Sato',
      'Room 5 · Judge R. Keane · Doyle won 28 to 27.5',
      result,
    ),
  ],
};

const finishedGroup = (round: string, count: number): AttentionGroup => ({
  attention: 'finished',
  count,
  rooms: finished[round] ?? [],
  more: sampleAction(`Show ${count - 3} more`),
});

export function sampleRunningRound(
  slug: string,
  event: string,
  round: string,
  scene: SampleScene,
): RunningRound | null {
  if (slug !== AUTUMN || event !== VARSITY || !(round in finished)) return null;
  if (!reached(scene, 'prelims')) return null;
  const running = round === '3' && !reached(scene, 'break');
  const drafting = !reached(scene, 'break');
  if (round === '4' && drafting) return null;
  const starts: Readonly<Record<string, string>> = {
    '1': '10:00',
    '2': '11:50',
    '3': '13:40',
    '4': '15:20',
  };
  return {
    event: varsitySwitch,
    title: `Round ${round}`,
    lede: running
      ? '24 rooms · started 13:40 · running 20 minutes late'
      : `24 rooms · started ${starts[round] ?? ''} · every ballot is in`,
    participantView: linkTo(
      'View as participant',
      tabRoutes.round(AUTUMN, VARSITY, round),
    ),
    next:
      round === '3' && drafting
        ? linkTo(
            'Open round 4 draw',
            hostRoutes.round(AUTUMN, VARSITY, '4'),
            true,
          )
        : null,
    groups: running
      ? [
          {
            attention: 'needs_you',
            count: null,
            rooms: [
              room(
                'Farrow v Okoye',
                'Judge M. Reyes has not opened the ballot · 18 minutes overdue',
                sampleAction('Replace judge', true),
              ),
              room(
                'Brooks v Petrov',
                'Dana Abara asked to record a forfeit. Brooks is from her school, so a second person confirms.',
                sampleAction('Review and confirm', true),
              ),
            ],
            more: null,
          },
          {
            attention: 'live',
            count: null,
            rooms: [
              room(
                'Reid v Nakata',
                'Room 10 · Judge A. Shah · fifth speech',
                sampleAction('Watch'),
              ),
            ],
            more: null,
          },
          {
            attention: 'judging',
            count: null,
            rooms: [
              room(
                'Okafor v Wu',
                'Room 3 · Judge T. Abara · ballot open 6 minutes',
                sampleAction('Open room'),
              ),
            ],
            more: null,
          },
          finishedGroup('3', 20),
        ]
      : [finishedGroup(round, 24)],
  };
}

const slotEvents = [
  ['varsity-ld', 'Varsity LD', null, '16 rooms · 14 ballots in, 2 judging'],
  ['novice-ld', 'Novice LD', null, '12 rooms · all ballots in'],
  [
    'varsity-pf',
    'Varsity PF',
    null,
    '14 rooms · 8 live, 5 judging, 1 waiting for a judge',
  ],
  [
    'parli',
    'Parli',
    'one pool, novices break separately',
    '19 rooms · resolution struck at 12:04 · 18 preparing, speeches begin 12:24 · 1 waiting for a judge',
  ],
] as const;

const slotNeeds = [
  [
    'parli',
    'Parli · Hartwell A v Ridgeview C',
    "Judge S. Cho hasn't finished ranking Impromptu section C from the 10:30 slot, so this room can't start.",
    'Swap judge',
  ],
  [
    'varsity-pf',
    'Varsity PF · Room 9',
    'Judge E. Fontaine dropped out. P. Nguyen is free in this slot, has no conflict here and is cleared for PF.',
    'Assign Nguyen',
  ],
  [
    'novice-ld',
    'Novice LD · round 3 draft is ready',
    'All 12 ballots are in. Round 3 can be published now or held until 15:00 with the other events.',
    'Review draw',
  ],
] as const;

export function sampleTimeSlot(
  slug: string,
  slot: string,
  event: string | null,
  scene: SampleScene,
): TimeSlot | null {
  if (slug !== WINTER || slot !== '1200' || !reached(scene, 'prelims'))
    return null;
  if (event !== null && !slotEvents.some(([id]) => id === event)) return null;
  const shown = <T extends readonly [string, ...unknown[]]>(
    rows: readonly T[],
  ) => rows.filter(([id]) => event === null || id === event);
  return {
    title: 'Debate round 2',
    lede: '12:00 · four events · 61 rooms · running 10 minutes late',
    participantView: linkTo(
      'View as participant',
      tabRoutes.tournament(WINTER),
    ),
    tabs: [
      {
        id: 'all',
        label: 'All events',
        href: hostRoutes.slot(WINTER, slot),
        selected: event === null,
      },
      ...slotEvents.map(([id, label]) => ({
        id,
        label,
        href: hostRoutes.slot(WINTER, slot, id),
        selected: event === id,
      })),
    ],
    needsYou: shown(slotNeeds).map(([, title, detail, label]) =>
      room(title, detail, sampleAction(label, true)),
    ),
    events: shown(slotEvents).map(([id, name, note, detail]) => ({
      slug: id,
      name,
      note,
      detail,
      rooms: sampleAction('Rooms'),
    })),
    next:
      event === null
        ? {
            heading: 'Next · Speech B round 1 at 13:30',
            items: [
              room(
                'Extemp and Interp sections are drawn',
                '7 sections. Four of their judges are in debate rooms now; all four are on time so far.',
                sampleAction('See judges'),
              ),
            ],
          }
        : null,
  };
}
