import type {
  TabRoundFixture,
  TabRoundHostView,
} from '@daisy/protocol/lobby/tab-round-read';
import { tabRoutes } from '../routes';
import type { RunningRoundContext } from '../tab-round';
import { eventSwitch } from './event-switch';
import { AUTUMN, IMPROMPTU, reached } from './moment';
import type { SampleScene } from './scene';
import {
  sampleFixture,
  sampleId,
  sampleInstant,
  sampleWallClock,
} from './tab-round';

const minutes = (n: number) => n * 60_000;

/** A section of speakers; those named first, then the rest of its seats. */
const section = (
  label: string,
  room: string,
  judges: readonly string[],
  speakers: readonly string[],
  size: number,
  state: TabRoundFixture['state'],
): TabRoundFixture => {
  const named = [
    ...speakers,
    ...Array.from(
      { length: size - speakers.length },
      (_, seat) => `Section ${label} speaker ${speakers.length + seat + 1}`,
    ),
  ];
  return {
    ...sampleFixture(`Section ${label}`, room, judges, state, 'section'),
    label,
    entries: named.map((name) => ({ entryId: sampleId(`entry${name}`), name })),
  };
};

/** A section the judges have ranked, in the order its speakers placed. */
const ranked = (
  label: string,
  room: string,
  judges: readonly string[],
  speakers: readonly string[],
  size: number,
): TabRoundFixture => {
  const fixture = section(label, room, judges, speakers, size, {
    kind: 'judging',
    ballotsIn: 0,
    ballotsDue: judges.length,
    openForMs: 0,
  });
  return {
    ...fixture,
    state: {
      kind: 'finished',
      result: {
        kind: 'decided',
        corrected: false,
        entries: fixture.entries.map((entry, place) => ({
          entryId: entry.entryId,
          won: null,
          rank: place + 1,
          points: null,
        })),
      },
    },
  };
};

const sectionsFinished = (): readonly TabRoundFixture[] => [
  ranked(
    'E',
    'Room 29',
    ['N. Varga', 'B. Achebe'],
    ['Hana Kim', 'Tomas Ruiz', 'Noor Aziz'],
    6,
  ),
  ranked(
    'F',
    'Room 30',
    ['C. Moreau', 'I. Tanaka'],
    ['Sam Ortega', 'Ivy Lund', 'Kofi Mensah'],
    5,
  ),
];

const sectionsOpen = (): readonly TabRoundFixture[] => [
  section('D', 'Room 28', ['K. Osei'], [], 6, {
    kind: 'ballot_overdue',
    judge: { tournamentJudgeId: sampleId('judgeK. Osei'), name: 'K. Osei' },
    overdueByMs: minutes(12),
    speechesGiven: 6,
  }),
  section('B', 'Room 26', ['G. Holt'], ['Leo Brandt'], 6, {
    kind: 'confirmation_requested',
    pendingCommandId: sampleId('pendingbrandtspeakagain'),
    summary:
      'Dana Abara asked to let Leo Brandt speak again after his connection dropped. He is from her school, so a second person confirms.',
    canConfirm: true,
  }),
  section('A', 'Room 25', ['R. Lindqvist', 'D. Marsh'], ['Priya Nair'], 6, {
    kind: 'speaking',
    segment: 4,
    segmentCount: 6,
    speaker: 'Priya Nair',
  }),
  section('C', 'Room 27', ['H. Okonkwo', 'J. Pruitt'], [], 6, {
    kind: 'judging',
    ballotsIn: 1,
    ballotsDue: 2,
    openForMs: minutes(5),
  }),
];

/** A speech event's round: sections of speakers ranked by two judges. */
export function speechRoundView(
  round: string,
  scene: SampleScene,
): { readonly read: TabRoundHostView; readonly context: RunningRoundContext } | null {
  if (round !== '3' || !reached(scene, 'prelims')) return null;
  const running = !reached(scene, 'break');
  return {
    read: {
      lobbyId: sampleId('autumnopen'),
      eventId: sampleId('eventimpromptu'),
      tabRound: {
        tabRoundId: sampleId('tabroundimpromptu3'),
        number: 3,
        name: null,
      },
      fixtureKind: 'section',
      fixtureCount: 6,
      entryCount: 35,
      sectionSize: 6,
      byeCountsAs: 'win',
      startedAt: sampleInstant('13:40'),
      progress: running
        ? { kind: 'running', behindByMs: minutes(10) }
        : { kind: 'complete' },
      postedToParticipants: false,
      next:
        running || reached(scene, 'elims')
          ? null
          : {
              tabRoundId: sampleId('tabroundimpromptufinal'),
              number: 4,
              name: 'Final',
            },
      open: running ? [...sectionsOpen()] : [],
      finished: { total: running ? 2 : 6, recent: [...sectionsFinished()] },
      capabilities: { officiate: true },
    },
    context: {
      event: eventSwitch(scene, IMPROMPTU),
      address: {
        posting: tabRoutes.tournament(AUTUMN),
        tournament: tabRoutes.tournament(AUTUMN),
        nextDraw: null,
      },
      wallClock: sampleWallClock,
    },
  };
}
