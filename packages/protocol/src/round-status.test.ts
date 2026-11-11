import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isRoundOver, isRoundRunning, roundStatuses } from './round';
import {
  isOpenRoomStatus,
  isRoomRoundLink,
  roomRoundLinkOf,
  roomStatuses,
} from './room-contract';

setupRitewayBun();

describe('the Round lifecycle vocabulary', () => {
  test('every status is running or over, never both', () => {
    assert({
      given: 'each Round status',
      should: 'place opening and active as running and the rest as over',
      actual: roundStatuses.map((status) => [
        status,
        isRoundRunning(status),
        isRoundOver(status),
      ]),
      expected: [
        ['opening', true, false],
        ['active', true, false],
        ['completed', false, true],
        ['abandoned', false, true],
      ],
    });
  });
});

describe('the Room lifecycle vocabulary', () => {
  test('a Room is open only while it gathers its players', () => {
    assert({
      given: 'each Room status',
      should: 'call only assembling and ready open',
      actual: roomStatuses.map((status) => [status, isOpenRoomStatus(status)]),
      expected: [
        ['assembling', true],
        ['ready', true],
        ['started', false],
        ['closed', false],
      ],
    });
  });
});

describe('a Room and the Round it launched', () => {
  const round = { id: 'r'.repeat(24), status: 'active' } as const;
  const pairs = roomStatuses.flatMap((status) =>
    [null, round].map((roundRef) => ({ status, roundRef })),
  );
  const named = (room: {
    readonly status: string;
    readonly roundRef: unknown;
  }) => `${room.status}/${room.roundRef === null ? '-' : 'round'}`;

  test('an open Room has launched none, and a started Room names its Round', () => {
    assert({
      given: 'every Room status with and without a Round',
      should: 'hold the pairs a Room can be in',
      actual: pairs.filter(isRoomRoundLink).map(named),
      expected: [
        'assembling/-',
        'ready/-',
        'started/round',
        'closed/-',
        'closed/round',
      ],
    });
  });

  test('a stored status and its Round row always read as one state', () => {
    assert({
      given: 'every Room status with and without a Round row',
      should:
        'read the pairs a Room can be in unchanged, a Room with a Round as started, and a started Room with none as closed',
      actual: pairs.map((room) =>
        named(roomRoundLinkOf(room.status, room.roundRef)),
      ),
      expected: [
        'assembling/-',
        'started/round',
        'ready/-',
        'started/round',
        'closed/-',
        'started/round',
        'closed/-',
        'closed/round',
      ],
    });
    assert({
      given: 'every reading',
      should: 'be a pair a Room can be in',
      actual: pairs.every((room) =>
        isRoomRoundLink(roomRoundLinkOf(room.status, room.roundRef)),
      ),
      expected: true,
    });
  });
});
