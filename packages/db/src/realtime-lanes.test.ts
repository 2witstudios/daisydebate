import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from './index';
import { fakeSql } from './index.test-support';

setupRitewayBun();

test('realtime topic authorization runs on a lane the realtime pool reserves', async () => {
  const refused: unknown[] = [];
  const database = createDatabase({
    url: 'postgresql://unit:unit@127.0.0.1:1/unit',
    client: fakeSql([]).client,
    workloadProfile: 'realtime',
    maxConnections: 4,
    eventSink: (event, fields) => {
      if (event === 'db.capacity.refused') refused.push(fields);
    },
    nextActorId: createId,
  });
  const caller = { userId: createId(), actorId: createId() };
  await Promise.allSettled([
    database.messagingChannelAuthority(
      { channelId: createId(), ...caller },
      async () => null,
    ),
    database.readRoomAuthorizationFacts(createId(), caller),
    database.readRoundAuthorizationFacts(createId(), caller),
  ]);
  assert({
    given: 'channel, room and round topic authorization on a realtime pool',
    should: 'reach the database instead of refusing an absent lane',
    actual: refused,
    expected: [],
  });
});
