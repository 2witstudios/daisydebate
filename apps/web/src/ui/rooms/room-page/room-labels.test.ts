import type { RoomView } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import {
  initials,
  roomChips,
  seatStatus,
  settingRows,
  speechGrow,
  waitingOn,
} from './room-labels';

setupRitewayBun();

const seated = (
  overrides: Partial<RoomView['participants'][number]>,
): RoomView['participants'][number] => ({
  id: 'p'.repeat(24),
  actorId: 'a'.repeat(24),
  kind: 'human' as const,
  label: 'Maya Okafor',
  role: 'negative' as const,
  slot: 0,
  needsReady: true,
  eligible: true,
  ready: 'not-ready' as const,
  consentVersion: 0,
  ...overrides,
});
const oneOnOne = {
  ...assemblySnapshot,
  definition: {
    ...assemblySnapshot.definition,
    seats: { affirmative: 1, negative: 1, judge: 1 },
  },
};

describe('room lobby waiting list', () => {
  test('names open seats, unready people and running preparation', () => {
    assert({
      given:
        'a ready viewer, an unready opponent, an open judge seat and running preparation',
      should: 'list who and what Launch waits on, in seat order',
      actual: waitingOn(
        {
          ...oneOnOne,
          participants: [
            seated({
              actorId: 'v'.repeat(24),
              role: 'affirmative',
              ready: 'ready',
              label: 'Sam',
            }),
            seated({}),
          ],
          prep: {
            startedAt: '2026-10-12T00:00:00Z',
            remainingMs: 1000,
            finished: false,
          },
        },
        'v'.repeat(24),
      ),
      expected: ['Maya Okafor', 'Judge', 'Preparation'],
    });
  });

  test('the viewer reads as You and server-managed seats never wait', () => {
    assert({
      given: 'an unready viewer and a bot that needs no Ready',
      should: 'name the viewer as You and skip the bot',
      actual: waitingOn(
        {
          ...oneOnOne,
          participants: [
            seated({ actorId: 'v'.repeat(24), role: 'affirmative' }),
            seated({ kind: 'bot', needsReady: false, label: 'Penny' }),
            seated({ role: 'judge', ready: 'ready', label: 'Judge person' }),
          ],
        },
        'v'.repeat(24),
      ),
      expected: ['You'],
    });
  });

  test('multi-seat sides name the numbered seat', () => {
    assert({
      given: 'two affirmative and three negative seats, all open',
      should: 'number each open seat and keep the single judge seat unnumbered',
      actual: waitingOn(assemblySnapshot, 'v'.repeat(24)),
      expected: [
        'Affirmative 1',
        'Affirmative 2',
        'Negative 1',
        'Negative 2',
        'Negative 3',
        'Judge',
      ],
    });
  });
});

describe('room lobby labels', () => {
  test('header chips come from the room configuration', () => {
    assert({
      given:
        'an assembling casual one-on-one full room, then a ranked team room',
      should: 'label status, shape with length, and competition type',
      actual: [
        roomChips(oneOnOne),
        roomChips({
          ...assemblySnapshot,
          competitionType: 'ranked',
          length: 'quick',
          status: 'started',
        }),
      ],
      expected: [
        ['Before the round', 'One-on-one · Full', 'Casual'],
        ['Round started', '2 v 3 · Quick', 'Ranked'],
      ],
    });
  });

  test('seat status reports server readiness without inventing it', () => {
    assert({
      given:
        'open, ineligible, server-managed, ready, unavailable and unready seats',
      should: 'name each actual state',
      actual: [
        seatStatus(undefined),
        seatStatus(seated({ eligible: false })),
        seatStatus(seated({ needsReady: false })),
        seatStatus(seated({ ready: 'ready' })),
        seatStatus(seated({ ready: 'unavailable' })),
        seatStatus(seated({})),
      ],
      expected: [
        'Open',
        'Not eligible',
        'Server managed',
        'Ready',
        'Readiness unavailable',
        'Not ready',
      ],
    });
  });

  test('speech weights follow duration within the static scale', () => {
    assert({
      given: 'a sub-minute, a five-minute and an over-long segment',
      should: 'grow in proportion to minutes, bounded to one through twelve',
      actual: [5000, 300000, 3600000].map(speechGrow),
      expected: ['grow-1', 'grow-5', 'grow-12'],
    });
  });

  test('setting rows read the saved configuration', () => {
    assert({
      given: 'saved prep, countdown and interaction settings',
      should: 'summarize every configured value',
      actual: settingRows(assemblySnapshot),
      expected: [
        ['Before the round', '5:21'],
        ['Prep', '14:47 each'],
        ['Countdown', '0:00.444'],
        ['Cross-ex', 'Free'],
        ['Interruptions', 'Off'],
        ['Yield', 'Off'],
      ],
    });
  });

  test('enabled interaction settings carry their detail', () => {
    assert({
      given: 'cross-ex-only interruptions and yielding that returns time',
      should: 'show the minimum remaining time and the yield consequence',
      actual: settingRows({
        ...assemblySnapshot,
        config: {
          ...assemblySnapshot.config,
          preRoundPrep: { enabled: false },
          inRoundPrep: { enabled: false },
          crossExamination: { crossExMode: 'ordered' },
          interruptions: { mode: 'cross_ex_only', minRemainingMs: 30000 },
          yielding: { allowed: true, returnsTime: true },
        },
      }).slice(3),
      expected: [
        ['Cross-ex', 'Ordered'],
        ['Interruptions', 'Cross-ex only'],
        ['Minimum remaining', '0:30'],
        ['Yield', 'Returns time'],
      ],
    });
  });
});

test('avatar initials take the first two words', () => {
  assert({
    given: 'a two-word name, a one-word name and a three-word name',
    should: 'return up to two capital initials',
    actual: ['Maya Okafor', 'penny', 'Ana  de Souza'].map(initials),
    expected: ['MO', 'P', 'AD'],
  });
});
