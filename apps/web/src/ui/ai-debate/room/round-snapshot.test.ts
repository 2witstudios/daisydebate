import type { AiDebateState } from '@daisy/debate-engine';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { AiDebateView } from '../../../features/ai-debate/operations';
import {
  botRoundSnapshot,
  botSpeeches,
  phaseOf,
  transcriptOf,
} from './round-snapshot';

setupRitewayBun();

const view: AiDebateView = {
  id: 'd1',
  resolution: 'This house would ban homework',
  personSide: 'negative',
  opponent: 'wren',
  voice: 'v',
  serverNow: 0,
  commands: [],
  utterances: [
    {
      id: 'u1',
      turnIndex: 0,
      role: 'ai',
      text: 'Homework harms sleep.',
      at: 10_000,
    },
    {
      id: 'u2',
      turnIndex: 2,
      role: 'person',
      text: 'Sleep is not the point.',
      at: 400_000,
    },
    {
      id: 'u3',
      turnIndex: 2,
      role: 'person',
      text: 'Practice is.',
      at: 430_000,
    },
    { id: 'u4', turnIndex: 4, role: 'ai', text: '', at: 900_000 },
  ],
  ballot: null,
};

const live = (turnIndex: number): AiDebateState => ({
  phase: 'live',
  turnIndex,
  startedAt: 0,
  endsAt: 300_000,
  remainingMs: 120_000,
  prepLeftMs: 200_000,
});

describe('botSpeeches', () => {
  test('the turns', () => {
    assert({
      given: 'the bot round turns',
      should: 'become the room speeches with their codes and kinds',
      actual: botSpeeches.map((s) => `${s.code}:${s.side}:${s.kind}`),
      expected: [
        'AC:aff:speech',
        'CX:neg:cross-ex',
        'NC:neg:speech',
        'CX:aff:cross-ex',
        '1AR:aff:speech',
        'NR:neg:speech',
        '2AR:aff:speech',
      ],
    });
  });
});

describe('phaseOf', () => {
  test('who holds the floor', () => {
    assert({
      given: 'a negative debater in the AC, the first CX, the NC and prep',
      should: 'lean to the opponent, cross-ex, their own speech and prep',
      actual: [
        phaseOf(live(0), 'negative'),
        phaseOf(live(1), 'negative'),
        phaseOf(live(2), 'negative'),
        phaseOf(
          { phase: 'prep', turnIndex: 5, prepStartedAt: 0, prepLeftMs: 1 },
          'negative',
        ),
      ],
      expected: ['opponent-speaking', 'cross-ex', 'own-speech', 'prep'],
    });
  });
});

describe('transcriptOf', () => {
  test('lines', () => {
    assert({
      given: 'the persisted lines',
      should: 'drop empty lines and time each from the first line of its turn',
      actual: transcriptOf(view).map((s) => [s.speechId, s.offsetMs]),
      expected: [
        ['t0', 0],
        ['t2', 0],
        ['t2', 30_000],
      ],
    });
  });
});

describe('botRoundSnapshot', () => {
  test('a live turn', () => {
    const round = botRoundSnapshot({
      view,
      state: live(2),
      bot: { id: 'wren', name: 'Wren' },
      listening: true,
    });
    assert({
      given: 'the NC live for a negative debater',
      should: 'light the NC, run its clock and carry their prep',
      actual: {
        kind: round.kind,
        liveIndex: round.liveIndex,
        clock: round.clock,
        prep: round.prepMs,
        mic: round.micLive,
        sides: [round.self.side, round.opponent.side],
      },
      expected: {
        kind: 'unrated',
        liveIndex: 2,
        clock: { label: 'NC', remainingMs: 120_000 },
        prep: { neg: 200_000, aff: 0 },
        mic: true,
        sides: ['neg', 'aff'],
      },
    });
  });

  test('before and after', () => {
    const at = (state: AiDebateState) =>
      botRoundSnapshot({
        view,
        state,
        bot: { id: 'wren', name: 'Wren' },
        listening: false,
      });
    assert({
      given: 'a debate not yet started, and one that is over',
      should: 'light no speech, then every speech as past',
      actual: [
        at({ phase: 'waiting' }).liveIndex,
        at({ phase: 'ended', endedAt: 1 }).liveIndex,
      ],
      expected: [-1, 7],
    });
  });
});
