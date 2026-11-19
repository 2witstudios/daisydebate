import type {
  TabRoundFixture,
  TabRoundHostView,
  TimeSlotHostView,
} from '@daisy/protocol/lobby/tab-round-read';
import { sampleFixture, sampleId, sampleInstant } from './fixture';
import { largeJudge, largeSurname } from './large-names';

/**
 * Autumn Open's varsity debate at scale: 200 entries in 100 rooms. The
 * ordinary sample's fixtures keep their rooms; the rest are named in order.
 */
export const LARGE_ROUND_FIXTURES = 100;
export const LARGE_ROUND_ENTRIES = 200;

const minutes = (n: number) => n * 60_000;

/** The ordinary sample's open fixtures of round 3, which stay where they are. */
const kept = new Set([
  'Farrow',
  'Okoye',
  'Brooks',
  'Petrov',
  'Reid',
  'Nakata',
  'Okafor',
  'Wu',
]);

/** Every pairing of the round past the kept ones, two entries at a time. */
const generatedTitles = (): readonly string[] => {
  const names = Array.from({ length: LARGE_ROUND_ENTRIES }, (_, n) =>
    largeSurname(n),
  ).filter((name) => !kept.has(name));
  return Array.from(
    { length: Math.floor(names.length / 2) },
    (_, n) => `${names[2 * n] ?? ''} v ${names[2 * n + 1] ?? ''}`,
  );
};

const overdue = (
  title: string,
  room: string,
  judge: string,
  late: number,
): TabRoundFixture =>
  sampleFixture(title, room, [judge], {
    kind: 'ballot_overdue',
    judge: { tournamentJudgeId: sampleId(`judge${judge}`), name: judge },
    overdueByMs: minutes(late),
    speechesGiven: 6,
  });

/**
 * Round 3 running at scale: six ballots overdue, one forfeit to confirm,
 * 28 more rooms judging, 40 in speeches and 25 finished, in the order the
 * tab keeps them (what needs the host first).
 */
export function largeRoundThreeOpen(): {
  readonly open: readonly TabRoundFixture[];
  readonly finishedTotal: number;
} {
  const titles = generatedTitles();
  const room = (n: number) => `Room ${n + 11}`;
  const judge = (n: number) => largeJudge(n + 18);
  const at = (n: number) => titles[n] ?? 'Ellis v Lowe';
  const overdueRooms = [0, 28, 29, 69, 70].map((n) =>
    overdue(at(n), room(n), judge(n), 12 + (n % 13)),
  );
  const judging = Array.from({ length: 27 }, (_, k) => k + 1).map((n) =>
    sampleFixture(at(n), room(n), [judge(n)], {
      kind: 'judging',
      ballotsIn: 0,
      ballotsDue: 1,
      openForMs: minutes(19 - Math.floor(n / 2)),
    }),
  );
  const speaking = Array.from({ length: 39 }, (_, k) => k + 30).map((n) =>
    sampleFixture(at(n), room(n), [judge(n)], {
      kind: 'speaking',
      segment: 1 + (n % 6),
      segmentCount: 6,
      speaker: null,
    }),
  );
  return {
    open: [
      overdue('Farrow v Okoye', 'Room 6', 'M. Reyes', 18),
      ...overdueRooms,
      sampleFixture('Brooks v Petrov', 'Room 8', ['S. Cho'], {
        kind: 'confirmation_requested',
        pendingCommandId: sampleId('pendingbrooksforfeit'),
        summary:
          'Dana Abara asked to record a forfeit. Brooks is from her school, so a second person confirms.',
        canConfirm: true,
      }),
      sampleFixture('Okafor v Wu', 'Room 3', ['T. Abara'], {
        kind: 'judging',
        ballotsIn: 0,
        ballotsDue: 1,
        openForMs: minutes(19),
      }),
      ...judging,
      sampleFixture('Reid v Nakata', 'Room 10', ['A. Shah'], {
        kind: 'speaking',
        segment: 5,
        segmentCount: 6,
        speaker: null,
      }),
      ...speaking,
    ],
    finishedTotal: 25,
  };
}

/** The ordinary read of a varsity round, grown to 100 rooms. */
export function largeVarsityRound(read: TabRoundHostView): TabRoundHostView {
  const running = read.progress.kind === 'running';
  const grown = largeRoundThreeOpen();
  return {
    ...read,
    fixtureCount: LARGE_ROUND_FIXTURES,
    entryCount: LARGE_ROUND_ENTRIES,
    open: running ? [...grown.open] : [],
    finished: {
      total: running ? grown.finishedTotal : LARGE_ROUND_FIXTURES,
      recent: [
        ...generatedTitles()
          .slice(running ? 71 : 0)
          .map((title, n) =>
            sampleFixture(
              title,
              `Room ${n + (running ? 82 : 11)}`,
              [largeJudge(n + 90)],
              {
                kind: 'finished',
                result: {
                  kind: 'administrative',
                  reason: 'forfeit',
                  corrected: false,
                },
              },
            ),
          ),
        ...(!running
          ? [...kept]
              .filter((_, n) => n % 2 === 0)
              .map((name, n) =>
                sampleFixture(
                  `${name} v ${[...kept][n * 2 + 1] ?? ''}`,
                  `Room ${n + 3}`,
                  [largeJudge(n)],
                  {
                    kind: 'finished',
                    result: {
                      kind: 'administrative',
                      reason: 'forfeit',
                      corrected: false,
                    },
                  },
                ),
              )
          : []),
      ],
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
  more: Partial<Pick<SlotEvent, 'separateBreaks' | 'fixtureKind'>> = {},
): SlotEvent => ({
  eventId: sampleId(`event${slug}`),
  name,
  formatName,
  fixtureKind: more.fixtureKind ?? 'pairing',
  separateBreaks: more.separateBreaks ?? [],
  tabRound: {
    tabRoundId: sampleId(`tabround${slug}4`),
    number: 4,
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
});

/** The large slot's four events, by the address slug each tab carries. */
export const largeSlotEvents: readonly (readonly [string, SlotEvent])[] = [
  [
    'ld',
    slotEvent(
      'ld',
      'LD',
      'LD',
      100,
      { live: 44, judging: 28, ballotsIn: 27, waitingForJudge: 1 },
      { separateBreaks: ['Novice'] },
    ),
  ],
  [
    'varsity-pf',
    slotEvent('varsity-pf', 'Varsity PF', 'PF', 10, {
      live: 6,
      judging: 1,
      ballotsIn: 2,
      waitingForJudge: 1,
    }),
  ],
  ['parli', slotEvent('parli', 'Parli', 'Parli', 6, { live: 4, judging: 2 })],
  [
    'impromptu',
    slotEvent(
      'impromptu',
      'Impromptu',
      'Impromptu',
      4,
      { judging: 2, ballotsIn: 2 },
      { fixtureKind: 'section' },
    ),
  ],
];

const judgeRef = (name: string) => ({
  tournamentJudgeId: sampleId(`judge${name}`),
  name,
});

/** Four judges withdrew from LD rooms; one has a free, clear replacement. */
const withdrawn = (
  room: number,
  judge: string,
  replacement: string | null,
) => ({
  kind: 'judge_withdrawn' as const,
  eventId: sampleId('eventld'),
  fixtureId: sampleId(`fixtureldroom${room}`),
  room: { roomId: sampleId(`roomld${room}`), name: `Room ${room}` },
  judge: judgeRef(judge),
  replacement: replacement === null ? null : judgeRef(replacement),
});

/** Winter Classic's 13:30 slot at scale: 120 rooms over four events. */
export const largeSlotView = (
  ordinary: TimeSlotHostView,
): TimeSlotHostView => ({
  ...ordinary,
  timeSlot: {
    timeSlotId: sampleId('slotwinter1330'),
    name: 'Round 4',
    startsAt: sampleInstant('13:30'),
  },
  events: largeSlotEvents.map(([, event]) => event),
  rooms: largeSlotEvents.flatMap(([, event], eventIndex) =>
    Array.from({ length: event.roomCount }, (_, n) => {
      const offset =
        largeSlotEvents
          .slice(0, eventIndex)
          .reduce((sum, [, one]) => sum + one.roomCount, 0) + n;
      const state: TabRoundFixture['state'] =
        offset < 2
          ? { kind: 'speaking', segment: 1, segmentCount: 6, speaker: null }
          : offset < 56
            ? { kind: 'speaking', segment: 2, segmentCount: 6, speaker: null }
            : offset < 90
              ? {
                  kind: 'judging',
                  ballotsIn: 0,
                  ballotsDue: 1,
                  openForMs: 60000,
                }
              : {
                  kind: 'finished',
                  result: {
                    kind: 'administrative',
                    corrected: false,
                    reason: 'forfeit',
                  },
                };
      return {
        eventId: event.eventId,
        fixture: sampleFixture(
          `${largeSurname(offset * 2)} v ${largeSurname(offset * 2 + 1)}`,
          `Room ${offset + 1}`,
          offset < 2 ? [] : [largeJudge(offset)],
          state,
        ),
      };
    }),
  ),
  concerns: [
    withdrawn(41, 'E. Fontaine', 'P. Nguyen'),
    {
      kind: 'judge_held_elsewhere',
      eventId: sampleId('eventvarsity-pf'),
      fixtureId: sampleId('fixturepfhartwellridgeview'),
      entries: ['Hartwell A', 'Ridgeview C'].map((name) => ({
        entryId: sampleId(`entry${name}`),
        name,
      })),
      judge: judgeRef('S. Cho'),
      elsewhere: {
        eventName: 'Impromptu',
        fixtureKind: 'section',
        fixtureLabel: 'C',
        timeSlotStartsAt: sampleInstant('10:30'),
      },
    },
    withdrawn(58, largeJudge(40), null),
    withdrawn(63, largeJudge(41), null),
    withdrawn(87, largeJudge(42), null),
    {
      kind: 'draw_ready',
      eventId: sampleId('eventparli'),
      tabRoundId: sampleId('tabroundparli5'),
      tabRoundNumber: 5,
      ballotsIn: 6,
      publishWithOthersAt: sampleInstant('15:00'),
    },
  ],
});
