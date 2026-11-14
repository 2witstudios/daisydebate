import type {
  TabRoundFixture,
  TabRoundHostView,
  TimeSlotHostView,
} from '@daisy/protocol/lobby/tab-round-read';
import { hostRoutes, tabRoutes } from '../routes';
import {
  type RunningRoundContext,
  type TimeSlotContext,
  type WallClock,
} from '../tab-round';
import {
  AUTUMN,
  IMPROMPTU,
  postedRounds,
  reached,
  VARSITY,
  WINTER,
} from './moment';
import { own } from './own';
import { varsitySwitch } from './event-switch';
import type { SampleScene } from './scene';
import { speechRoundView } from './speech-round';

/** A sample's stand-in for a cuid2 id: the seed's letters, padded to 24. */
export const sampleId = (seed: string): string =>
  seed
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, '')
    .padEnd(24, '0')
    .slice(0, 24);

/** A sample instant on the tournament's day, given as its wall-clock time. */
export const sampleInstant = (time: string): string =>
  `2026-10-17T${time}:00.000Z`;

/** The samples keep their instants in the tournament's own wall-clock time. */
export const sampleWallClock: WallClock = (instant) => instant.slice(11, 16);

const minutes = (n: number) => n * 60_000;

/** The samples' parts of a fixture that every state shares. */
export const sampleFixture = (
  title: string,
  room: string | null,
  judges: readonly string[],
  state: TabRoundFixture['state'],
  kind: TabRoundFixture['kind'] = 'pairing',
): TabRoundFixture => ({
  fixtureId: sampleId(`fixture${title}${room ?? ''}`),
  kind,
  label: null,
  entries: title
    .split(' v ')
    .map((name) => ({ entryId: sampleId(`entry${name}`), name })),
  room: room === null ? null : { roomId: sampleId(`room${room}`), name: room },
  judges: judges.map((name) => ({
    tournamentJudgeId: sampleId(`judge${name}`),
    name,
  })),
  conflict: false,
  state,
});

/** A debate decided by its panel: the winner's points, then the loser's. */
const decided = (
  title: string,
  room: string,
  judge: string,
  winner: string,
  points: readonly [number, number],
  corrected = false,
): TabRoundFixture => {
  const fixture = sampleFixture(title, room, [judge], {
    kind: 'finished',
    result: { kind: 'administrative', corrected, reason: 'bye' },
  });
  return {
    ...fixture,
    state: {
      kind: 'finished',
      result: {
        kind: 'decided',
        corrected,
        entries: fixture.entries.map((entry) => ({
          entryId: entry.entryId,
          won: entry.name === winner,
          rank: null,
          points: entry.name === winner ? points[0] : points[1],
        })),
      },
    },
  };
};

const bye = (name: string): TabRoundFixture => ({
  ...sampleFixture(name, null, [], {
    kind: 'finished',
    result: { kind: 'administrative', corrected: false, reason: 'bye' },
  }),
  kind: 'bye',
});

const finished: Readonly<Record<string, readonly TabRoundFixture[]>> = {
  '1': [
    decided('Jensen v Brooks', 'Room 1', 'L. Malik', 'Jensen', [28.5, 27.5]),
    decided('Castillo v Petrov', 'Room 2', 'P. Nguyen', 'Castillo', [28, 27]),
    decided('Okafor v Ellis', 'Room 3', 'T. Abara', 'Okafor', [29, 26.5]),
  ],
  '2': [
    decided('Jensen v Wu', 'Room 1', 'A. Costa', 'Jensen', [29, 28]),
    decided('Reid v Nakata', 'Room 7', 'S. Cho', 'Nakata', [28, 27.5], true),
    decided('Castillo v Doyle', 'Room 2', 'R. Keane', 'Castillo', [28.5, 28]),
  ],
  '3': [
    decided('Jensen v Amari', 'Room 1', 'L. Malik', 'Jensen', [28.5, 27]),
    decided('Haddad v Castillo', 'Room 2', 'P. Nguyen', 'Castillo', [29, 28]),
    bye('Ellis'),
  ],
  '4': [
    decided('Jensen v Amari', 'Room 1', 'L. Malik', 'Jensen', [29, 27.5]),
    decided('Haddad v Castillo', 'Room 2', 'P. Nguyen', 'Castillo', [28.5, 28]),
    decided('Doyle v Sato', 'Room 5', 'R. Keane', 'Doyle', [28, 27.5]),
  ],
};

const starts: Readonly<Record<string, string>> = {
  '1': '10:00',
  '2': '11:50',
  '3': '13:40',
  '4': '15:20',
};

const roundThreeOpen: readonly TabRoundFixture[] = [
  sampleFixture('Farrow v Okoye', 'Room 6', ['M. Reyes'], {
    kind: 'ballot_overdue',
    judge: { tournamentJudgeId: sampleId('judgeM. Reyes'), name: 'M. Reyes' },
    overdueByMs: minutes(18),
    speechesGiven: 6,
  }),
  sampleFixture('Brooks v Petrov', 'Room 8', ['S. Cho'], {
    kind: 'confirmation_requested',
    pendingCommandId: sampleId('pendingbrooksforfeit'),
    summary:
      'Dana Abara asked to record a forfeit. Brooks is from her school, so a second person confirms.',
    canConfirm: true,
  }),
  sampleFixture('Reid v Nakata', 'Room 10', ['A. Shah'], {
    kind: 'speaking',
    segment: 5,
    segmentCount: 6,
    speaker: null,
  }),
  sampleFixture('Okafor v Wu', 'Room 3', ['T. Abara'], {
    kind: 'judging',
    ballotsIn: 0,
    ballotsDue: 1,
    openForMs: minutes(6),
  }),
];

/** Varsity debate's tab round as the host reads it. */
function varsityRoundView(
  round: string,
  scene: SampleScene,
): TabRoundHostView | null {
  const recent = own(finished, round);
  if (recent === null || !reached(scene, 'prelims')) return null;
  const running = round === '3' && !reached(scene, 'break');
  const drafting = !reached(scene, 'break');
  if (round === '4' && drafting) return null;
  return {
    lobbyId: sampleId('autumnopen'),
    eventId: sampleId('eventvarsity'),
    tabRound: {
      tabRoundId: sampleId(`tabroundvarsity${round}`),
      number: Number(round),
      name: null,
    },
    fixtureKind: 'pairing',
    fixtureCount: 24,
    entryCount: 48,
    sectionSize: null,
    byeCountsAs: 'win',
    startedAt: sampleInstant(own(starts, round) ?? '10:00'),
    progress: running
      ? { kind: 'running', behindByMs: minutes(20) }
      : { kind: 'complete' },
    // Participants have a posting for the round running and the one after.
    postedToParticipants: postedRounds.includes(round),
    next:
      round === '3' && drafting
        ? { tabRoundId: sampleId('tabroundvarsity4'), number: 4, name: null }
        : null,
    open: running ? [...roundThreeOpen] : [],
    finished: { total: running ? 20 : 24, recent: [...recent] },
    capabilities: { officiate: true },
  };
}

/** A tab round's host read, with what the running round needs beside it. */
export function sampleTabRoundView(
  slug: string,
  event: string,
  round: string,
  scene: SampleScene,
): {
  readonly read: TabRoundHostView;
  readonly context: RunningRoundContext;
} | null {
  if (slug !== AUTUMN) return null;
  if (event === IMPROMPTU) return speechRoundView(round, scene);
  if (event !== VARSITY) return null;
  const read = varsityRoundView(round, scene);
  return read === null
    ? null
    : {
        read,
        context: {
          event: varsitySwitch(scene),
          address: {
            posting: tabRoutes.round(AUTUMN, VARSITY, round),
            tournament: tabRoutes.tournament(AUTUMN),
            nextDraw: hostRoutes.round(AUTUMN, VARSITY, '4'),
          },
          wallClock: sampleWallClock,
        },
      };
}

type SlotEvent = TimeSlotHostView['events'][number];

const slotEvent = (
  slug: string,
  name: string,
  formatName: string,
  roomCount: number,
  fixtures: Partial<SlotEvent['fixtures']>,
  more: Partial<Pick<SlotEvent, 'separateBreaks' | 'resolution'>> = {},
): SlotEvent => ({
  eventId: sampleId(`event${slug}`),
  name,
  formatName,
  fixtureKind: 'pairing',
  separateBreaks: [],
  tabRound: {
    tabRoundId: sampleId(`tabround${slug}2`),
    number: 2,
    drawStatus: 'published',
  },
  roomCount,
  fixtures: {
    waitingForJudge: 0,
    preparing: 0,
    live: 0,
    judging: 0,
    ballotsIn: 0,
    ...fixtures,
  },
  resolution: null,
  ...more,
});

const slotEvents: readonly (readonly [string, SlotEvent])[] = [
  [
    'varsity-ld',
    slotEvent('varsity-ld', 'Varsity LD', 'LD', 16, {
      ballotsIn: 14,
      judging: 2,
    }),
  ],
  [
    'novice-ld',
    slotEvent('novice-ld', 'Novice LD', 'LD', 12, { ballotsIn: 12 }),
  ],
  [
    'varsity-pf',
    slotEvent('varsity-pf', 'Varsity PF', 'PF', 14, {
      live: 8,
      judging: 5,
      waitingForJudge: 1,
    }),
  ],
  [
    'parli',
    slotEvent(
      'parli',
      'Parli',
      'Parli',
      19,
      { preparing: 18, waitingForJudge: 1 },
      {
        separateBreaks: ['Novices'],
        resolution: {
          releasedAt: sampleInstant('12:04'),
          speechesBeginAt: sampleInstant('12:24'),
        },
      },
    ),
  ],
];

const judge = (name: string) => ({
  tournamentJudgeId: sampleId(`judge${name}`),
  name,
});

const slotView: TimeSlotHostView = {
  lobbyId: sampleId('winterclassic'),
  timeSlot: {
    timeSlotId: sampleId('slotwinter1200'),
    name: 'Debate round 2',
    startsAt: sampleInstant('12:00'),
  },
  behindByMs: minutes(10),
  events: slotEvents.map(([, event]) => event),
  concerns: [
    {
      kind: 'judge_held_elsewhere',
      eventId: sampleId('eventparli'),
      fixtureId: sampleId('fixtureparlihartwellridgeview'),
      entries: ['Hartwell A', 'Ridgeview C'].map((name) => ({
        entryId: sampleId(`entry${name}`),
        name,
      })),
      judge: judge('S. Cho'),
      elsewhere: {
        eventName: 'Impromptu',
        fixtureKind: 'section',
        fixtureLabel: 'C',
        timeSlotStartsAt: sampleInstant('10:30'),
      },
    },
    {
      kind: 'judge_withdrawn',
      eventId: sampleId('eventvarsity-pf'),
      fixtureId: sampleId('fixturepfroom9'),
      room: { roomId: sampleId('roompf9'), name: 'Room 9' },
      judge: judge('E. Fontaine'),
      replacement: judge('P. Nguyen'),
    },
    {
      kind: 'draw_ready',
      eventId: sampleId('eventnovice-ld'),
      tabRoundId: sampleId('tabroundnovice-ld3'),
      tabRoundNumber: 3,
      ballotsIn: 12,
      publishWithOthersAt: sampleInstant('15:00'),
    },
  ],
  next: {
    timeSlotId: sampleId('slotwinter1330'),
    name: 'Speech B round 1',
    startsAt: sampleInstant('13:30'),
    drawnEvents: ['Extemp', 'Interp'].map((name) => ({
      eventId: sampleId(`event${name}`),
      name,
      fixtureKind: 'section' as const,
    })),
    fixtureCount: 7,
    judgesSeatedHere: 4,
    judgesRunningLate: 0,
  },
  capabilities: { officiate: true, editDraw: true },
};

/** Winter Classic's noon slot as the host reads it, with its addresses. */
export function sampleTimeSlotView(
  slug: string,
  slot: string,
  scene: SampleScene,
): {
  readonly read: TimeSlotHostView;
  readonly context: Omit<TimeSlotContext, 'selectedEventId'>;
  readonly eventIdOf: (eventSlug: string | null) => string | null;
} | null {
  if (slug !== WINTER || slot !== '1200' || !reached(scene, 'prelims'))
    return null;
  const slugOf = (eventId: string) =>
    slotEvents.find(([, event]) => event.eventId === eventId)?.[0] ?? eventId;
  return {
    read: slotView,
    context: {
      address: {
        slot: (eventId) =>
          hostRoutes.slot(
            WINTER,
            slot,
            eventId === null ? null : slugOf(eventId),
          ),
        tournament: tabRoutes.tournament(WINTER),
      },
      wallClock: sampleWallClock,
    },
    eventIdOf: (eventSlug) =>
      slotEvents.find(([known]) => known === eventSlug)?.[1].eventId ?? null,
  };
}
