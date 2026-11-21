import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/messaging/test-fixture';
import { messageRequestSettingOperations } from '../src/messaging/request-settings';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('a member’s message request setting is stored as chosen, and everyone is no row', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const store = messageRequestSettingOperations({
    database: drizzle({ client }),
  });
  const { userId, otherUserId } = fixture;
  const rows = async (user: string) =>
    (
      (await client.unsafe(
        'select count(*)::int as n from messaging_request_settings where user_id=$1',
        [user],
      )) as { n: number }[]
    )[0]!.n;
  try {
    const read = () => store.readMessageRequestSetting({ userId });
    const unset = await read();
    await store.writeMessageRequestSetting({ userId, setting: 'friends' });
    const friends = await read();
    await store.writeMessageRequestSetting({ userId, setting: 'none' });
    const none = [await read(), await rows(userId)];
    await store.writeMessageRequestSetting({ userId, setting: 'everyone' });
    const everyone = [await read(), await rows(userId)];
    await client.unsafe('update users set deleted_at=now() where id=$1', [
      otherUserId,
    ]);
    await store.writeMessageRequestSetting({
      userId: otherUserId,
      setting: 'none',
    });
    assert({
      given:
        'no row, Friends only, No one, back to Everyone, and a closed account choosing No one',
      should:
        'read everyone with no row, keep one row per choice, delete it for everyone, and write nothing for a closed account',
      actual: {
        unset,
        friends,
        none,
        everyone,
        closed: await rows(otherUserId),
      },
      expected: {
        unset: 'everyone',
        friends: 'friends',
        none: ['none', 1],
        everyone: ['everyone', 0],
        closed: 0,
      },
    });
  } finally {
    await client.unsafe(
      'delete from messaging_request_settings where user_id in ($1,$2)',
      [userId, otherUserId],
    );
    await fixture.cleanup();
    await client.close();
  }
});
