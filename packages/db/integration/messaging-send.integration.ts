import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { createMessagingStore } from '../src/messaging/store';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('fresh messaging transactions bind the canonical actor and acquire current authority', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const { userId, actorId, channelId } = fixture;
  try {
    await assertRejects({
      given: 'a fresh locked channel whose canonical authorizer refuses',
      should: 'refuse protected receipt reads inside the same transaction',
      actual: () =>
        createMessagingStore({
          database,
          authorize: async () => {
            throw createAppError('AUTHORIZATION');
          },
        }).withChannel({ channelId, actorId, userId }, async (frame) => {
          await frame.authorize();
          return frame.readSendState({
            version: 1,
            channelId,
            requestId: createId(),
            text: 'Forbidden',
          });
        }),
      code: 'AUTHORIZATION',
    });
    const result = await createMessagingStore({
      database,
      authorize: async () => {},
    }).withChannel({ channelId, actorId, userId }, async (frame) => ({
      fact: frame.fact,
      member: frame.accounts.some(
        (account) =>
          account?.actorId === actorId &&
          account.userId === userId &&
          account.member,
      ),
      counters: frame.counters,
    }));
    assert({
      given: 'a durable accepted DM and live bound account',
      should:
        'load current canonical authority and empty independent counters in one transaction',
      actual: {
        member: result.member,
        authority: result.fact.authority.kind,
        counters: result.counters,
      },
      expected: {
        member: true,
        authority: 'dm',
        counters: { channelId, messageSequence: 0, changeVersion: 0 },
      },
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
