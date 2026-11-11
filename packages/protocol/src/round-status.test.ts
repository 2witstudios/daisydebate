import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isRoundOver, isRoundRunning, roundStatuses } from './round';
import { isOpenRoomStatus, roomStatuses } from './room-contract';

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
