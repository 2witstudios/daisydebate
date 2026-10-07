import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import type {
  AiDebateView,
  UiState,
} from '../../../features/ai-debate/context';
import {
  botRoundSnapshot,
  phaseOf,
  speechesOf,
  transcriptOf,
} from './round-snapshot';

setupRitewayBun();

const resolved = resolveRoomConfiguration(
  oneOnOneDefinition,
  practiceRoomConfig,
);
if (!resolved.ok) throw new Error(resolved.refusal.message);

const view: AiDebateView = {
  id: 'd1',
  resolution: 'This house would ban homework',
  personSide: 'negative',
  opponent: 'wren',
  voice: 'v',
  serverNow: 0,
  version: 1,
  status: 'active',
  startedAt: 0,
  rules: resolved.rules,
  segments: [],
  checkpoint: {
    version: 1,
    prep_consumed_ms: { affirmative: 0, negative: 0 },
    active_prep: null,
    floor: null,
  },
  utterances: [
    {
      id: 'u1',
      segmentIndex: 0,
      role: 'ai',
      text: 'Homework harms sleep.',
      complete: true,
      at: 10_000,
    },
    {
      id: 'u2',
      segmentIndex: 2,
      role: 'person',
      text: 'Sleep is not the point.',
      complete: true,
      at: 400_000,
    },
    {
      id: 'u3',
      segmentIndex: 2,
      role: 'person',
      text: 'Practice is.',
      complete: true,
      at: 430_000,
    },
    {
      id: 'u4',
      segmentIndex: 4,
      role: 'ai',
      text: '',
      complete: true,
      at: 900_000,
    },
  ],
  ballot: null,
};

const live = (segmentIndex: number): UiState => ({
  phase: 'live',
  segmentIndex,
  remainingMs: 120_000,
});

describe('speechesOf', () => {
  test('the resolved schedule', () => {
    assert({
      given: "the practice room's resolved segments",
      should: 'become the room speeches with their codes and kinds',
      actual: speechesOf(view).map((s) => `${s.code}:${s.side}:${s.kind}`),
      expected: [
        'AC:aff:speech',
        'CX1:neg:cross-ex',
        'NC:neg:speech',
        'CX2:aff:cross-ex',
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
        phaseOf(live(0), view, 'negative'),
        phaseOf(live(1), view, 'negative'),
        phaseOf(live(2), view, 'negative'),
        phaseOf(
          { phase: 'prep', segmentIndex: 5, remainingMs: 1 },
          view,
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
      should:
        'drop empty lines and time each from the first line of its segment',
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
  test('a live segment', () => {
    const round = botRoundSnapshot({
      view,
      state: live(2),
      bot: { id: 'wren', name: 'Wren' },
      listening: true,
    });
    assert({
      given: 'the NC live for a negative debater',
      should: 'light the NC and run its clock',
      actual: {
        kind: round.kind,
        liveIndex: round.liveIndex,
        clock: round.clock,
        mic: round.micLive,
        sides: [round.self.side, round.opponent.side],
      },
      expected: {
        kind: 'unrated',
        liveIndex: 2,
        clock: { label: 'NC', remainingMs: 120_000 },
        mic: true,
        sides: ['neg', 'aff'],
      },
    });
  });

  test('before and after', () => {
    const at = (state: UiState) =>
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
        at({ phase: 'ended' }).liveIndex,
      ],
      expected: [-1, 7],
    });
  });
});
