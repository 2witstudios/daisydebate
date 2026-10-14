import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture, sqlStateOf } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('every channel owns one checked stream row that lives and dies with it', async () => {
  await withFixture(url, async (f) => {
    const channelId = createId();
    await f.sql`insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle) values(${channelId},'dm','social.dm',1,'active')`;
    const stream = () =>
      f.sql`select message_sequence::int as "messageSequence", change_version::int as "changeVersion" from messaging_channel_streams where channel_id=${channelId}`;
    const created = await stream();
    const ahead = await sqlStateOf(
      () =>
        f.sql`update messaging_channel_streams set message_sequence=2, change_version=1 where channel_id=${channelId}`,
    );
    const beyondSafe = await sqlStateOf(
      () =>
        f.sql`update messaging_channel_streams set change_version=9007199254740992 where channel_id=${channelId}`,
    );
    await f.sql`delete from messaging_channels where id=${channelId}`;
    assert({
      given: 'a channel created directly, then invalid counters, then deletion',
      should:
        'create its zeroed stream row, refuse sequence beyond change or past the safe integer, and remove it with the channel',
      actual: { created, ahead, beyondSafe, after: (await stream()).length },
      expected: {
        created: [{ messageSequence: 0, changeVersion: 0 }],
        ahead: '23514',
        beyondSafe: '23514',
        after: 0,
      },
    });
  });
});
