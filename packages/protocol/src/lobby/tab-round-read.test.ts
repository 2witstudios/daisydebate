import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '../authorization';
import { parseEach, parseOutcome, parsedUnchanged } from '../parse-outcome.test-support';
import {
  tabRoundHostViewSchema,
  tabRoundReadCatalogue,
  timeSlotHostViewSchema,
} from './tab-round-read';

setupRitewayBun();

const id = (seed: string) => seed.padEnd(24, 'x');
const at = (time: string) => `2026-10-17T${time}:00.000Z`;

const fixtureOf = (seed: string, state: unknown) => ({
  fixtureId: id(`fixture${seed}`),
  kind: 'pairing',
  label: null,
  entries: [
    { entryId: id(`entry${seed}a`), name: 'Farrow' },
    { entryId: id(`entry${seed}b`), name: 'Okoye' },
  ],
  room: { roomId: id(`room${seed}`), name: 'Room 6' },
  judges: [{ tournamentJudgeId: id('judgereyes'), name: 'M. Reyes' }],
  conflict: false,
  state,
});

const states = [
  {
    kind: 'ballot_overdue',
    judge: { tournamentJudgeId: id('judgereyes'), name: 'M. Reyes' },
    overdueByMs: 1_080_000,
    speechesGiven: 6,
  },
  {
    kind: 'confirmation_requested',
    pendingCommandId: id('pending'),
    summary: 'Dana Abara asked to record a forfeit.',
    canConfirm: false,
  },
  { kind: 'speaking', segment: 5, segmentCount: 6, speaker: null },
  { kind: 'judging', ballotsIn: 1, ballotsDue: 2, openForMs: 300_000 },
];

const finished = [
  fixtureOf('decided', {
    kind: 'finished',
    result: {
      kind: 'decided',
      corrected: true,
      entries: [
        { entryId: id('entrydecideda'), won: true, rank: null, points: 28.5 },
        { entryId: id('entrydecidedb'), won: false, rank: null, points: 27.5 },
      ],
    },
  }),
  {
    ...fixtureOf('bye', {
      kind: 'finished',
      result: { kind: 'administrative', corrected: false, reason: 'bye' },
    }),
    kind: 'bye',
    room: null,
    judges: [],
  },
];

const tabRoundView = {
  lobbyId: id('lobby'),
  eventId: id('event'),
  tabRound: { tabRoundId: id('tabround3'), number: 3, name: null },
  fixtureKind: 'pairing',
  fixtureCount: 24,
  entryCount: 48,
  sectionSize: null,
  byeCountsAs: 'win',
  startedAt: at('13:40'),
  progress: { kind: 'running', behindByMs: 1_200_000 },
  postedToParticipants: true,
  next: { tabRoundId: id('tabround4'), number: 4, name: null },
  open: states.map((state, index) => fixtureOf(`open${index}`, state)),
  finished: { total: 20, recent: finished },
  capabilities: { officiate: true },
};

const slotEvent = (seed: string, name: string) => ({
  eventId: id(`event${seed}`),
  name,
  formatName: 'LD',
  fixtureKind: 'pairing',
  separateBreaks: [],
  tabRound: { tabRoundId: id(`tabround${seed}`), number: 2, drawStatus: 'published' },
  roomCount: 16,
  fixtures: { waitingForJudge: 0, preparing: 0, live: 0, judging: 2, ballotsIn: 14 },
  resolution: null,
});

const slotView = {
  lobbyId: id('lobby'),
  timeSlot: { timeSlotId: id('slot'), name: 'Debate round 2', startsAt: at('12:00') },
  behindByMs: 600_000,
  events: [
    slotEvent('ld', 'Varsity LD'),
    {
      ...slotEvent('parli', 'Parli'),
      separateBreaks: ['Novices'],
      resolution: { releasedAt: at('12:04'), speechesBeginAt: at('12:24') },
    },
  ],
  concerns: [
    {
      kind: 'judge_held_elsewhere',
      eventId: id('eventparli'),
      fixtureId: id('fixtureparli'),
      entries: [{ entryId: id('entryhartwell'), name: 'Hartwell A' }],
      judge: { tournamentJudgeId: id('judgecho'), name: 'S. Cho' },
      elsewhere: {
        eventName: 'Impromptu',
        fixtureKind: 'section',
        fixtureLabel: 'C',
        timeSlotStartsAt: at('10:30'),
      },
    },
    {
      kind: 'judge_withdrawn',
      eventId: id('eventld'),
      fixtureId: id('fixtureld'),
      room: { roomId: id('room9'), name: 'Room 9' },
      judge: { tournamentJudgeId: id('judgefontaine'), name: 'E. Fontaine' },
      replacement: null,
    },
    {
      kind: 'draw_ready',
      eventId: id('eventld'),
      tabRoundId: id('tabroundld3'),
      tabRoundNumber: 3,
      ballotsIn: 12,
      publishWithOthersAt: null,
    },
  ],
  next: null,
  capabilities: { officiate: false, editDraw: false },
};

describe('the running tab round read', () => {
  test('a tab round with a fixture in every state', () => {
    assert({
      given: 'a running round and the same round complete with nothing open',
      should: 'parse each as it is',
      actual: parseEach(tabRoundHostViewSchema, [
        tabRoundView,
        { ...tabRoundView, progress: { kind: 'complete' }, next: null, open: [] },
      ]),
      expected: parsedUnchanged([
        tabRoundView,
        { ...tabRoundView, progress: { kind: 'complete' }, next: null, open: [] },
      ]),
    });
  });

  test('what a tab round read refuses', () => {
    assert({
      given: 'an address, a fixture state outside the list and a fixture status word',
      should: 'refuse each at the field',
      actual: parseEach(tabRoundHostViewSchema, [
        { ...tabRoundView, participantHref: '/tournaments/x' },
        { ...tabRoundView, open: [fixtureOf('x', { kind: 'paused' })] },
        { ...tabRoundView, open: [{ ...fixtureOf('x', states[2]), kind: 'heat' }] },
      ]),
      expected: [
        { issues: ['(root)'] },
        { issues: ['open.0.state.kind'] },
        { issues: ['open.0.kind'] },
      ],
    });
  });
});

describe('the time slot read', () => {
  test('one time slot across every event in it', () => {
    assert({
      given: 'a slot with two events and each kind of concern, and one with a next slot',
      should: 'parse each as it is',
      actual: [
        slotView,
        {
          ...slotView,
          next: {
            timeSlotId: id('slotnext'),
            name: 'Speech B round 1',
            startsAt: at('13:30'),
            drawnEvents: [{ eventId: id('eventextemp'), name: 'Extemp', fixtureKind: 'section' }],
            fixtureCount: 7,
            judgesSeatedHere: 4,
            judgesRunningLate: 0,
          },
        },
      ].map(
        (view) => timeSlotHostViewSchema.safeParse(view).data?.events.length ?? null,
      ),
      expected: [2, 2],
    });
  });

  test('what a time slot read refuses', () => {
    assert({
      given: 'a slot with no events, and an unknown key',
      should: 'refuse each',
      actual: parseEach(timeSlotHostViewSchema, [
        { ...slotView, events: [] },
        { ...slotView, recompute: true },
      ]),
      expected: [{ issues: ['events'] }, { issues: ['(root)'] }],
    });
  });

  test('every tab round read answers under the host read gate', () => {
    assert({
      given: 'the tab round read catalogue',
      should: 'name lobby.host.read, a real capability, for each read',
      actual: Object.values(tabRoundReadCatalogue).map((read) =>
        read.gate.map((gate) => parseOutcome(authorizationCapabilitySchema, gate)),
      ),
      expected: [[{ data: 'lobby.host.read' }], [{ data: 'lobby.host.read' }]],
    });
  });
});
