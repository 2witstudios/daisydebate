import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createRoomCommunitySchemas,
  roomCommunityReadsOnly,
  roomCommunitySeatReadsOnly,
  youthRoomOf,
} from './room-community';
setupRitewayBun();
const schemas = createRoomCommunitySchemas({
  messageUnits: 4000,
  pageItems: 100,
});
const roomId = 'r'.repeat(24),
  channelId = 'c'.repeat(24),
  requestId = 'q'.repeat(24);
describe('Room chat contracts', () => {
  test('portable bounded commands', () =>
    assert({
      given: 'a Room chat open, an oversized send and metadata',
      should:
        'validate real IDs and canonical Messaging limits without accepting extra authorities',
      actual: [
        schemas.open.safeParse({ version: 1, roomId }).success,
        schemas.open.safeParse({ version: 1, roomId, actorId: requestId })
          .success,
        schemas.open.safeParse({ version: 1, roundId: roomId }).success,
        schemas.send.safeParse({
          version: 1,
          channelId,
          requestId,
          text: 'x'.repeat(4001),
        }).success,
        schemas.metadata.safeParse({
          version: 1,
          roomId,
          channelId,
          readOnly: false,
          expiresAt: null,
        }).success,
      ],
      expected: [true, false, false, false, true],
    }));
  test('channel bound older pagination', () =>
    assert({
      given: 'a cursor from another channel',
      should: 'refuse cross-channel pagination before any persistence read',
      actual: schemas.history.safeParse({
        version: 1,
        channelId,
        limit: 10,
        before: { channelId: requestId, sequence: 1 },
      }).success,
      expected: false,
    }));
  test('the seat that reads without posting', () =>
    assert({
      given: 'each seat kind and no seat',
      should: 'be read-only for the judge alone',
      actual: (['side', 'speaker', 'judge', 'moderator', null] as const).map(
        roomCommunitySeatReadsOnly,
      ),
      expected: [false, false, true, false, false],
    }));
  test('a Youth Room (decision 84, ADR 0156)', () => {
    assert({
      given: 'a Room of the Youth lobby and one of the Open lobby, ranked or casual',
      should: 'be a Youth Room exactly when it was created in the Youth lobby',
      actual: [
        youthRoomOf({ division: 'youth' }),
        youthRoomOf({ division: 'open' }),
      ],
      expected: [true, false],
    });
  });
  test('who reads Room chat without posting', () => {
    const reader = (
      seatKind: 'side' | 'judge' | null,
      host: boolean,
      youthRoom: boolean,
      youthStaff: boolean,
    ) => roomCommunityReadsOnly({ seatKind, host, youthRoom, youthStaff });
    assert({
      given:
        'a judge, a debater, the host and a seatless visitor, in an Open Room and in a Youth Room, and a youth debater’s club staff without a seat',
      should:
        'make the judge read only everywhere, a seatless visitor read only in a Youth Room, and keep debaters, the host and club staff posting',
      actual: [
        reader('judge', false, false, false),
        reader('judge', false, true, true),
        reader('side', false, true, false),
        reader(null, true, true, false),
        reader(null, false, false, false),
        reader(null, false, true, false),
        reader(null, false, true, true),
      ],
      expected: [true, true, false, false, false, true, false],
    });
  });
});
