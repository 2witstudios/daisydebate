import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createRoomCommunitySchemas } from './room-community';
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
});
