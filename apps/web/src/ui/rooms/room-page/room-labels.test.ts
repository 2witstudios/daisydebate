import type { RoomView } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import {
  formatLine,
  roomMeta,
  roomStatus,
  seatStatus,
  startRefusalText,
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
      should: 'list who and what Start round waits on, in seat order',
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
      expected: ['Maya Okafor', 'Judge', 'Prep before the round'],
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
  test('the status line counts filled seats while the room sets up', () => {
    assert({
      given:
        'an assembling one-on-one room with nobody seated, then a started room',
      should:
        'name the status in plain words and count seats only while setting up',
      actual: [
        roomStatus(oneOnOne),
        roomStatus({ ...assemblySnapshot, status: 'started' }),
        roomStatus({ ...assemblySnapshot, status: 'abandoned' }),
      ],
      expected: ['Setting up · 0 of 3 seats filled', 'In progress', 'Closed'],
    });
  });

  test('the meta line names the host, who can join and what the result counts for', () => {
    assert({
      given:
        'a hosted unlisted casual room, then a ranked public room without a host label',
      should: 'explain visibility and rating in words, with no badges',
      actual: [
        roomMeta({
          hostLabel: 'Maya',
          visibility: 'unlisted',
          competitionType: 'casual',
        }),
        roomMeta({
          hostLabel: null,
          visibility: 'public',
          competitionType: 'ranked',
        }),
      ],
      expected: [
        [
          'Hosted by Maya',
          'Anyone with the link',
          'Casual · ratings don’t change',
        ],
        ['Listed in the lobby', 'Ranked · counts toward ratings'],
      ],
    });
  });

  test('the format line reads NvN and a derived length', () => {
    assert({
      given: 'a one-on-one room with two short speeches and no prep',
      should: 'read 1v1 with its length rounded to five minutes',
      actual: formatLine({
        ...oneOnOne,
        config: {
          ...oneOnOne.config,
          inRoundPrep: { enabled: false },
        },
      }),
      expected: '1v1 · about 5 min',
    });
  });

  test('a start refusal reads as what the room still needs', () => {
    assert({
      given:
        'an incomplete cast, a version conflict and a member in another room',
      should: 'never show the raw refusal code',
      actual: [
        startRefusalText('incomplete-cast'),
        startRefusalText('version-conflict'),
        startRefusalText('active-room'),
      ],
      expected: [
        'every seat to be filled',
        'the latest room changes',
        'everyone to leave their other rooms',
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
        'Always ready',
        'Ready',
        'Checking devices',
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
        ['Prep before the round', '5:21'],
        ['Prep time', '14:47 per side'],
        ['Countdown before each speech', '0:00.444'],
        ['Cross-examination', 'Open floor'],
        ['Interruptions', 'Off'],
        ['Ending a speech early', 'Off'],
      ],
    });
  });

  test('enabled interaction settings carry their detail', () => {
    assert({
      given: 'cross-ex-only interruptions and yielding that returns time',
      should: 'show the protected end and where unused time goes',
      actual: settingRows({
        ...assemblySnapshot,
        config: {
          ...assemblySnapshot.config,
          preRoundPrep: { enabled: false },
          resolutionDraw: { enabled: false },
          inRoundPrep: { enabled: false },
          crossExamination: { crossExMode: 'ordered' },
          interruptions: { mode: 'cross_ex_only', minRemainingMs: 30000 },
          yielding: { allowed: true, returnsTime: true },
        },
      }).slice(3),
      expected: [
        ['Cross-examination', 'Questioner leads'],
        ['Interruptions', 'Only during cross-examination'],
        ['Protected end of each speech', '0:30'],
        [
          'Ending a speech early',
          'On — unused time goes back to that side’s prep time, when prep time is on',
        ],
      ],
    });
  });

  test('a resolution strike leads the summary', () => {
    const draw = (
      source:
        | { kind: 'bank'; categories: ('policy' | 'value' | 'fact')[] }
        | { kind: 'host'; count: number },
    ) =>
      settingRows({
        ...assemblySnapshot,
        config: {
          ...assemblySnapshot.config,
          resolutionDraw: {
            enabled: true,
            drawSize: 5,
            strikeWindowMs: 60_000,
            firstStriker: 'negative',
            source,
          },
        },
      })[0];
    assert({
      given: 'a five-resolution strike from the bank, then from the host list',
      should:
        'name the draw, its source, who strikes first and the strike time',
      actual: [
        draw({ kind: 'bank', categories: ['policy', 'value'] }),
        draw({ kind: 'host', count: 5 }),
      ],
      expected: [
        [
          'Resolution strike',
          '5 from Daisy’s Policy and Value resolutions · Negative strikes first · 1:00 per strike',
        ],
        [
          'Resolution strike',
          '5 from the host’s list · Negative strikes first · 1:00 per strike',
        ],
      ],
    });
  });
});
