import type { ChatMessage } from '../../features/debate-room/chat';
import type { SpeechSlot } from '../../features/debate-room/documents/documents';
import type { RoundPhase } from '../../features/debate-room/layout';
import type { TranscriptSegment } from '../../features/debate-room/transcript';
import type { RoundKind } from '../../features/debate-room/workspace';
import type { Debater, RoundSnapshot } from '../debate-room/round';
import { sampleRoomDocuments } from './debate-room-docs';

const minutes = (n: number) => n * 60_000;

const speeches: readonly SpeechSlot[] = [
  { id: 'ac', code: 'AC', side: 'aff', kind: 'speech', durationMs: minutes(5) },
  {
    id: 'cx1',
    code: 'CX',
    side: 'neg',
    kind: 'cross-ex',
    durationMs: minutes(3),
  },
  { id: 'nc', code: 'NC', side: 'neg', kind: 'speech', durationMs: minutes(6) },
  {
    id: 'cx2',
    code: 'CX',
    side: 'aff',
    kind: 'cross-ex',
    durationMs: minutes(3),
  },
  {
    id: '1ar',
    code: '1AR',
    side: 'aff',
    kind: 'speech',
    durationMs: minutes(5),
  },
  { id: 'nr', code: 'NR', side: 'neg', kind: 'speech', durationMs: minutes(5) },
  {
    id: '2ar',
    code: '2AR',
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

const segment = (
  id: string,
  speechId: string,
  offsetMs: number,
  text: string,
): TranscriptSegment => ({
  id,
  speechId,
  offsetMs,
  text,
});

const transcript: readonly TranscriptSegment[] = [
  segment(
    't1',
    'ac',
    12_000,
    'Plastic in the ocean doesn’t go away. That’s why this harm outweighs.',
  ),
  segment('t2', 'ac', 65_000, 'Eight million tonnes a year enter the ocean.'),
  segment(
    't3',
    'ac',
    220_000,
    'Kenya banned plastic bags in 2017, and it worked.',
  ),
  segment('t4', 'nc', 20_000, 'Weigh this round on net emissions.'),
  segment(
    't5',
    'nc',
    130_000,
    'Paper and glass carry higher lifecycle emissions.',
  ),
  segment('t6', 'nc', 270_000, 'The plan has no medical exemption.'),
  segment(
    't7',
    '1ar',
    62_000,
    'On their framework, plastic is permanent. Emissions are not.',
  ),
  segment(
    't8',
    '1ar',
    118_000,
    'Fibers degrade within months. That turn goes away.',
  ),
  segment(
    't9',
    '1ar',
    131_000,
    'On the medical point, our plan exempts hospitals, so',
  ),
];

const phases: Readonly<
  Record<
    RoundPhase,
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
};

/** The sample round, as the negative debater sees it in the given phase. */
export function sampleRound(phase: RoundPhase, kind: RoundKind): RoundSnapshot {
  const at = phases[phase];
  return {
    resolution: 'This house would ban single-use plastics',
    kind,
    phase,
    self,
    opponent,
    speeches,
    liveIndex: at.liveIndex,
    clock: at.clock,
    prepMs: { neg: at.prepMs, aff: 120_000 },
    micLive: at.micLive,
    clubName: 'Riverside Debate',
    documents: sampleRoomDocuments,
    channels: [
      { id: 'round', title: 'round', scope: 'round' },
      { id: 'prep', title: 'prep', scope: 'club' },
      { id: 'general', title: 'general', scope: 'club' },
    ],
    messages,
    agents: [
      { id: 'assistant', title: 'Assistant', scope: 'round' },
      { id: 'coach', title: 'Coach', scope: 'club' },
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
      coach: [
        { id: 'c1', from: 'you', text: 'Drill me on Kenya answers.' },
        {
          id: 'c2',
          from: 'agent',
          text: 'Aff says Kenya cut bag use. Your answer in under 15 seconds?',
        },
      ],
    },
    agentPrompts: {
      assistant: [
        'What did they drop?',
        'Add the 1AR to Flow',
        'Tighten my NR plan',
      ],
      coach: ['Drill me', 'Review my last round'],
    },
    transcript,
  };
}
