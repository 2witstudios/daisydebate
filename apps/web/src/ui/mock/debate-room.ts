import type { CompetitionType } from '@daisy/protocol';
import type { ChatMessage } from '../../features/debate-room/chat';
import type { SpeechSlot } from '../../features/debate-room/speeches';
import { judgingClockOf } from '../../features/debate-room/judging';
import type { RoundPhase } from '../../features/debate-room/layout';
import type { Debater, RoundSnapshot } from '../debate-room/round';
import { sampleRoomDocuments } from './debate-room-docs';

const minutes = (n: number) => n * 60_000;

const speeches: readonly SpeechSlot[] = [
  {
    id: 'ac',
    code: 'AC',
    name: 'Affirmative constructive',
    side: 'aff',
    kind: 'speech',
    durationMs: minutes(5),
  },
  {
    id: 'cx1',
    code: 'CX',
    name: 'Cross-examination of the affirmative',
    side: 'neg',
    kind: 'cross-ex',
    durationMs: minutes(3),
  },
  {
    id: 'nc',
    code: 'NC',
    name: 'Negative constructive',
    side: 'neg',
    kind: 'speech',
    durationMs: minutes(6),
  },
  {
    id: 'cx2',
    code: 'CX',
    name: 'Cross-examination of the negative',
    side: 'aff',
    kind: 'cross-ex',
    durationMs: minutes(3),
  },
  {
    id: '1ar',
    code: '1AR',
    name: 'First affirmative rebuttal',
    side: 'aff',
    kind: 'speech',
    durationMs: minutes(5),
  },
  {
    id: 'nr',
    code: 'NR',
    name: 'Negative rebuttal',
    side: 'neg',
    kind: 'speech',
    durationMs: minutes(5),
  },
  {
    id: '2ar',
    code: '2AR',
    name: 'Second affirmative rebuttal',
    side: 'aff',
    kind: 'speech',
    durationMs: minutes(3),
  },
];

const self: Debater = {
  id: 'u-sam',
  name: 'Sam Reyes',
  initials: 'SR',
  side: 'neg',
  rating: 1702,
};
const opponent: Debater = {
  id: 'u-maya',
  name: 'Maya Okafor',
  initials: 'MO',
  side: 'aff',
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
    opponent,
    people: [
      { id: opponent.id, name: opponent.name, role: 'aff', bot: false },
      { id: self.id, name: self.name, role: 'neg', bot: false },
      { id: 'u-judge', name: 'Judge', role: 'judge', bot: false },
    ],
    judge: 'human',
    ballots: { judge: 'human', ai: 'ready' },
    judgingState: null,
    stakes: competition === 'ranked' ? { win: 14, loss: 12 } : null,
    recording: true,
    speeches,
    liveIndex: at.liveIndex,
    clock: at.clock,
    prepMs: { neg: at.prepMs, aff: 120_000 },
    micLive: at.micLive,
    documents: sampleRoomDocuments,
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
