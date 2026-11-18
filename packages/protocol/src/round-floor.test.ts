import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createRoundFloorSchemas,
  withLinkedAdultAudience,
  type RoundFloorFact,
} from './round-floor';
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

const floorFact = (
  actorId: string,
  audience: RoundFloorFact['audience'],
): RoundFloorFact => ({
  kind: 'round_floor',
  roundId: 'round',
  channelId: 'channel',
  policyKey: 'round.floor',
  policyRevision: 1,
  revision: 1,
  status: 'active',
  completedAt: null,
  actorId,
  audience,
});
const youth = { linkedAdultActorIds: ['coach'] };

describe('withLinkedAdultAudience', () => {
  test('a linked adult outside the named audience', () => {
    assert({
      given: "a Youth Round's linked adult whom the Round names nowhere",
      should: 'name them a linked adult (ADR 0155)',
      actual: withLinkedAdultAudience(floorFact('coach', null), youth).audience,
      expected: 'linked_adult',
    });
  });
  test('everyone else is unchanged', () => {
    assert({
      given:
        'a linked adult who debates or hosts, a stranger, and the coach on a Round that is not a Youth one',
      should: 'keep the audience the Round names',
      actual: [
        withLinkedAdultAudience(floorFact('coach', 'debater'), youth).audience,
        withLinkedAdultAudience(floorFact('coach', 'host'), youth).audience,
        withLinkedAdultAudience(floorFact('stranger', null), youth).audience,
        withLinkedAdultAudience(floorFact('coach', null), null).audience,
      ],
      expected: ['debater', 'host', null, null],
    });
  });
});
