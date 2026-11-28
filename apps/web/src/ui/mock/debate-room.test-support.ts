import type { CompetitionType } from '@daisy/protocol/round';
import type { SeatRef } from '@daisy/protocol/seats';
import type { ChatMessage } from '../../features/debate-room/chat';
import type { SpeechSlot } from '../../features/debate-room/speeches';
import { judgingClockOf } from '../../features/round-runtime/judging-window';
import type { RoundPhase } from '../../features/debate-room/layout';
import type { Debater, RoundSnapshot } from '../debate-room/round';

const minutes = (n: number) => n * 60_000;

const speeches: readonly SpeechSlot[] = [
  {
    id: 'ac',
    code: 'AC',
    name: 'Affirmative constructive',
    lead: { kind: 'side', side: 'affirmative', slot: 0 },
    kind: 'speech',
    durationMs: minutes(5),
  },
  {
    id: 'cx1',
    code: 'CX',
    name: 'Cross-examination of the affirmative',
    lead: { kind: 'side', side: 'negative', slot: 0 },
    kind: 'cross-ex',
    durationMs: minutes(3),
  },
  {
    id: 'nc',
    code: 'NC',
    name: 'Negative constructive',
    lead: { kind: 'side', side: 'negative', slot: 0 },
    kind: 'speech',
    durationMs: minutes(6),
  },
  {
    id: 'cx2',
    code: 'CX',
    name: 'Cross-examination of the negative',
    lead: { kind: 'side', side: 'affirmative', slot: 0 },
    kind: 'cross-ex',
    durationMs: minutes(3),
  },
  {
    id: '1ar',
    code: '1AR',
    name: 'First affirmative rebuttal',
    lead: { kind: 'side', side: 'affirmative', slot: 0 },
    kind: 'speech',
    durationMs: minutes(5),
  },
  {
    id: 'nr',
    code: 'NR',
    name: 'Negative rebuttal',
    lead: { kind: 'side', side: 'negative', slot: 0 },
    kind: 'speech',
    durationMs: minutes(5),
  },
  {
    id: '2ar',
    code: '2AR',
    name: 'Second affirmative rebuttal',
    lead: { kind: 'side', side: 'affirmative', slot: 0 },
    kind: 'speech',
    durationMs: minutes(3),
  },
];

const negSeat: SeatRef = { kind: 'side', side: 'negative', slot: 0 };
const affSeat: SeatRef = { kind: 'side', side: 'affirmative', slot: 0 };
const self: Debater = {
  id: 'u-sam',
  name: 'Sam Reyes',
  initials: 'SR',
  seat: negSeat,
  side: 'negative',
  sideLabel: 'Negative',
  sideShort: 'Neg',
  tone: 'clay',
  rating: 1702,
};
const opponent: Debater = {
  id: 'u-maya',
  name: 'Maya Okafor',
  initials: 'MO',
  seat: affSeat,
  side: 'affirmative',
  sideLabel: 'Affirmative',
  sideShort: 'Aff',
  tone: 'sky',
  rating: 1684,
};

const message = (
  id: string,
  channelId: string,
  author: ChatMessage['author'],
  text: string,
  minute: number,
): ChatMessage => ({
  id,
  channelId,
  author,
  text,
  sentAt: `2026-10-05T18:${String(minute).padStart(2, '0')}:00.000Z`,
});

const judge = { id: 'u-judge', name: 'Judge', role: 'judge' } as const;
const room = { id: 'system', name: 'Room', role: 'system' } as const;
const ana = { id: 'u-ana', name: 'Coach Ana', role: 'member' } as const;

const messages: readonly ChatMessage[] = [
  message('m1', 'round', room, 'NC ended at 6:00.', 14),
  message(
    'm2',
    'round',
    { id: opponent.id, name: opponent.name, role: 'debater' },
    'Can you hear me now?',
    18,
  ),
  message(
    'm3',
    'round',
    judge,
    'Aff audio cut for 3 s at 1:40. Clock was held.',
    19,
  ),
  message('m4', 'prep', ana, 'Round 3 pairings are up.', 2),
  message(
    'm5',
    'prep',
    { id: 'u-lena', name: 'lena', role: 'member' },
    'anyone have a block for “bans work”?',
    9,
  ),
  message('m6', 'prep', ana, 'Blocks: bans is in the club files.', 11),
  message('m7', 'general', ana, 'Practice moves to Thursday this week.', 5),
];

const phases: Readonly<
  Record<
    Exclude<RoundPhase, 'waiting'>,
    Pick<RoundSnapshot, 'liveIndex' | 'clock' | 'micLive'> & {
      readonly prepMs: number;
    }
  >
> = {
  'opponent-speaking': {
    liveIndex: 4,
    clock: { label: '1AR', remainingMs: 166_000 },
    micLive: false,
    prepMs: 72_000,
  },
  'cross-ex': {
    liveIndex: 1,
    clock: { label: 'CX · You ask', remainingMs: 108_000 },
    micLive: true,
    prepMs: 120_000,
  },
  prep: {
    liveIndex: 5,
    clock: { label: 'Your prep', remainingMs: 48_000 },
    micLive: false,
    prepMs: 48_000,
  },
  'own-speech': {
    liveIndex: 5,
    clock: { label: 'NR', remainingMs: 192_000 },
    micLive: true,
    prepMs: 0,
  },
  judging: {
    liveIndex: 7,
    clock: judgingClockOf(
      { state: 'human_window', deadlineAt: new Date(1_800_000).toISOString() },
      350_000,
    ),
    micLive: true,
    prepMs: 0,
  },
};

/** The sample round, as the negative debater sees it in the given phase. */
export function sampleRound(
  phase: Exclude<RoundPhase, 'waiting'>,
  competition: CompetitionType,
): RoundSnapshot {
  const at = phases[phase];
  return {
    id: 'sample-round',
    resolution: 'This house would ban single-use plastics',
    competition,
    phase,
    self,
    others: [opponent],
    groups: [
      { key: 'affirmative', title: 'Affirmative', judges: false },
      { key: 'negative', title: 'Negative', judges: false },
      { key: 'judge', title: 'Judge', judges: true },
    ],
    people: [
      {
        id: opponent.id,
        name: opponent.name,
        group: 'affirmative',
        judge: false,
        bot: false,
      },
      {
        id: self.id,
        name: self.name,
        group: 'negative',
        judge: false,
        bot: false,
      },
      {
        id: 'u-judge',
        name: 'Judge',
        group: 'judge',
        judge: true,
        bot: false,
      },
    ],
    judge: 'human',
    ballots: { judge: 'human', ai: 'ready' },
    judgingState: null,
    stakes: competition === 'ranked' ? { win: 14, loss: 12 } : null,
    speeches,
    liveIndex: at.liveIndex,
    clock: at.clock,
    prep: [
      {
        side: 'affirmative',
        label: 'Affirmative',
        tone: 'sky',
        remainingMs: 120_000,
        ended: false,
      },
      {
        side: 'negative',
        label: 'Negative',
        tone: 'clay',
        remainingMs: at.prepMs,
        ended: false,
      },
    ],
    micLive: at.micLive,
    point: null,
    prepCalled: null,
    channels: [
      { id: 'round', title: 'round' },
      { id: 'prep', title: 'prep' },
      { id: 'general', title: 'general' },
    ],
    messages,
    agents: [
      { id: 'assistant', title: 'Assistant' },
      { id: 'drill', title: 'Drill partner' },
    ],
    agentThreads: {
      assistant: [
        {
          id: 'a1',
          from: 'you',
          text: 'Tighten my NR plan. N3 doesn’t need 30 seconds.',
        },
        {
          id: 'a2',
          from: 'agent',
          text: 'Agreed: N3 is new in the 1AR, so name it and move on.',
          edit: {
            documentId: 'doc-nr',
            removed: ['0:30 N3 hospital exemption New in 1AR'],
            added: [
              '0:15 N3 hospital exemption, call it out and move on',
              '0:15 extra time on N2 weighing',
            ],
          },
        },
      ],
      drill: [
        { id: 'c1', from: 'you', text: 'Drill me on Kenya answers.' },
        {
          id: 'c2',
          from: 'agent',
          text: 'Aff says Kenya cut bag use. Your answer in under 15 seconds?',
        },
      ],
    },
    agentPrompts: {
      assistant: ['What did they drop?', 'Tighten my NR plan'],
      drill: ['Drill me', 'Review my last round'],
    },
  };
}
