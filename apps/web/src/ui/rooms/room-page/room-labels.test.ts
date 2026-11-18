import type { RoomView } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import {
  chatAuthorSeat,
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
  seat: { kind: 'side', side: 'negative', slot: 0 } as const,
  teamOpen: false,
  positionOpen: false,
  rating: null,
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
    seats: {
      sides: { affirmative: 1, negative: 1 },
      speakers: 0,
      judges: 1,
      moderators: 0 as const,
    },
  },
};

describe('room lobby waiting list', () => {
  test('names open seats and unready people', () => {
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
              seat: { kind: 'side', side: 'affirmative', slot: 0 },
              ready: 'ready',
              label: 'Sam',
            }),
            seated({}),
          ],
        },
        'v'.repeat(24),
      ),
      expected: ['Maya Okafor', 'Judge'],
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
            seated({
              actorId: 'v'.repeat(24),
              seat: { kind: 'side', side: 'affirmative', slot: 0 },
            }),
            seated({ kind: 'bot', needsReady: false, label: 'Penny' }),
            seated({
              seat: { kind: 'judge', slot: 0 },
              ready: 'ready',
              label: 'Judge person',
            }),
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
      actual: waitingOn(
        { ...assemblySnapshot, teamOneSide: 'affirmative' },
        'v'.repeat(24),
      ),
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

  test('open seats before the sides are decided (ADR 0145)', () => {
    const twoVsTwo = {
      ...assemblySnapshot,
      definition: {
        ...assemblySnapshot.definition,
        seats: {
          sides: { affirmative: 2, negative: 2 },
          speakers: 0,
          judges: 0,
          moderators: 0 as const,
        },
      },
    };
    const oneVsOne = {
      ...assemblySnapshot,
      definition: {
        ...assemblySnapshot.definition,
        seats: {
          sides: { affirmative: 1, negative: 1 },
          speakers: 0,
          judges: 0,
          moderators: 0 as const,
        },
      },
    };
    assert({
      given:
        'a 2 v 2 Room on the coin flip, the same with team 1 on Negative, and a 1 v 1 on the coin flip',
      should:
        'name each seat by team and position, then by the side its team argues, then by team alone',
      actual: [
        waitingOn({ ...twoVsTwo, teamOneSide: null }, 'v'.repeat(24)),
        waitingOn({ ...twoVsTwo, teamOneSide: 'negative' }, 'v'.repeat(24)),
        waitingOn({ ...oneVsOne, teamOneSide: null }, 'v'.repeat(24)),
      ],
      expected: [
        ['Team 1 · 1st', 'Team 1 · 2nd', 'Team 2 · 1st', 'Team 2 · 2nd'],
        ['Negative 1', 'Negative 2', 'Affirmative 1', 'Affirmative 2'],
        ['Team 1', 'Team 2'],
      ],
    });
  });
});

describe('room lobby labels', () => {
  test('the status line counts filled seats until Start', () => {
    assert({
      given:
        'an assembling one-on-one room with nobody seated, the same room with every seat filled, then a started and a closed room',
      should:
        'count seats before Start, never say it is ready to start, and name the status after',
      actual: [
        roomStatus(oneOnOne),
        roomStatus({ ...oneOnOne, status: 'ready' }),
        roomStatus({ ...assemblySnapshot, status: 'started' }),
        roomStatus({ ...assemblySnapshot, status: 'closed' }),
      ],
      expected: [
        '0 of 3 seats filled',
        '0 of 3 seats filled',
        'In progress',
        'Closed',
      ],
    });
  });

  test('the meta line names the host, who can join and what the result counts for', () => {
    assert({
      given:
        'a hosted unlisted casual room, a ranked public room without a host label, and a hosted ranked room',
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
        roomMeta({
          hostLabel: 'Coach',
          visibility: 'public',
          competitionType: 'ranked',
        }),
      ],
      expected: [
        ['Hosted by Maya', 'Anyone with the link', 'Casual'],
        ['Listed in the lobby', 'Ranked'],
        ['Hosted by Coach', 'Listed in the lobby', 'Ranked'],
      ],
    });
  });

  test('an event Room no person hosts (Tab)', () => {
    assert({
      given: 'a Room no person hosts, whose host label is empty',
      should: 'name no host rather than an empty one',
      actual: roomMeta({
        hostLabel: '',
        visibility: 'private',
        competitionType: 'casual',
      }),
      expected: ['Invite only', 'Casual'],
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
          preRoundPrep: { enabled: false },
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
          interruptions: { mode: 'enabled', minRemainingMs: 30000 },
          yielding: { allowed: true, returnsTime: true },
        },
      }).slice(3),
      expected: [
        ['Interruptions', 'During any speech'],
        ['Protected end of each speech', '0:30'],
        ['Ending a speech early', 'On · time back to prep'],
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

describe('chatAuthorSeat', () => {
  test('names only the seats this viewer may know (RCHAT-10)', () => {
    const host = 'h'.repeat(24);
    const debater = 'd'.repeat(24);
    const view = {
      hostActorId: host,
      rules: assemblySnapshot.rules,
      teamOneSide: 'affirmative' as const,
      status: 'assembling' as const,
      definition: assemblySnapshot.definition,
      participants: [
        seated({
          actorId: debater,
          seat: { kind: 'side', side: 'negative', slot: 0 } as const,
        }),
        seated({
          actorId: host,
          seat: { kind: 'side', side: 'affirmative', slot: 1 } as const,
        }),
        // A judge this viewer may not name carries no actor (DEC-174).
        {
          seat: { kind: 'judge' as const, slot: 0 },
          kind: 'human' as const,
          anonymous: true as const,
          teamOpen: false,
          positionOpen: false,
          rating: null,
          needsReady: true,
          eligible: true,
          ready: 'not-ready' as const,
        },
      ],
    };
    assert({
      given:
        'a named debater, a seated host, a seatless host, a visitor and an anonymous judge',
      should:
        'label the seat and the host mark, and say nothing for anyone the view does not name',
      actual: [
        chatAuthorSeat(view, debater),
        chatAuthorSeat(view, host),
        chatAuthorSeat({ ...view, participants: [] }, host),
        chatAuthorSeat(view, 'v'.repeat(24)),
      ],
      expected: ['Negative 1', 'Affirmative 2 · host', 'host', null],
    });
    const equal = {
      ...view,
      definition: {
        ...assemblySnapshot.definition,
        seats: {
          sides: { affirmative: 2, negative: 2 },
          speakers: 0,
          judges: 1,
          moderators: 0 as const,
        },
      },
    };
    assert({
      given: 'the same seats on the coin flip, then with team 1 on Negative',
      should:
        'name each seat as the roster shows it, never a side it may not play',
      actual: [
        chatAuthorSeat({ ...equal, teamOneSide: null }, host),
        chatAuthorSeat({ ...equal, teamOneSide: 'negative' }, host),
        chatAuthorSeat({ ...equal, teamOneSide: 'negative' }, debater),
      ],
      expected: ['Team 1 · 2nd · host', 'Negative 2 · host', 'Affirmative 1'],
    });
  });
});
