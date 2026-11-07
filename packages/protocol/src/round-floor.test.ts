import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createRoundFloorSchemas } from './round-floor';
setupRitewayBun();
const schemas = createRoundFloorSchemas({ messageUnits: 4000, pageItems: 100 });
const roundId = 'r'.repeat(24),
  channelId = 'c'.repeat(24),
  requestId = 'q'.repeat(24);
describe('Round floor contracts', () => {
  test('portable bounded commands', () =>
    assert({
      given: 'a floor open, send and malformed metadata',
      should:
        'validate real IDs and canonical Messaging limits without accepting extra authorities',
      actual: [
        schemas.open.safeParse({ version: 1, roundId }).success,
        schemas.open.safeParse({ version: 1, roundId, actorId: requestId })
          .success,
        schemas.send.safeParse({
          version: 1,
          channelId,
          requestId,
          text: 'x'.repeat(4001),
        }).success,
        schemas.metadata.safeParse({
          version: 1,
          roundId,
          channelId,
          readOnly: true,
          expiresAt: '2027-05-05T00:00:00.000Z',
        }).success,
      ],
      expected: [true, false, false, true],
    }));
  test('channel bound older pagination', () =>
    assert({
      given: 'a cursor from another private channel',
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
