import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withInboxHeaders } from './observation.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
test('durable DM association and contact writers advance actor collection headers without hints', async () => {
  await withInboxHeaders(url, async ({ f, fixture, read }) => {
    const initial = await read();
    await f.sql`update messaging_dm_pairs set request_state='pending',decided_at=null where channel_id=${fixture.channelId}`;
    const pending = await read();
    await f.sql`update messaging_dm_pairs set request_sender_actor_id=${fixture.otherActorId} where channel_id=${fixture.channelId}`;
    const swapped = await read();
    await f.sql`update messaging_dm_pairs set introduction='Content alone' where channel_id=${fixture.channelId}`;
    const same = await read();
    await f.sql`update messaging_dm_pairs set request_state='accepted',decided_at=clock_timestamp() where channel_id=${fixture.channelId}`;
    const accepted = await read();
    await f.sql`update messaging_contact_pairs set low_blocks_high=true,revision=revision+1 where low_actor_id=${fixture.low} and high_actor_id=${fixture.high}`;
    const blocked = await read();
    assert({
      given:
        'actual DM request/accept and contact restriction writers without any relay',
      should:
        'initialize and advance both owning actor collection heads while content alone stays stable',
      actual: {
        initial: initial.length,
        pending: pending.map(
          (h, i) => h.contentRevision - initial[i]!.contentRevision,
        ),
        same,
        swapped: swapped.map(
          (h, i) => h.contentRevision - pending[i]!.contentRevision,
        ),
        accepted: accepted.map(
          (h, i) => h.contentRevision - swapped[i]!.contentRevision,
        ),
        purge: blocked.map(
          (h, i) => h.purgeGeneration - accepted[i]!.purgeGeneration,
        ),
      },
      expected: {
        initial: 2,
        pending: [1, 1],
        same: swapped,
        swapped: [1, 1],
        accepted: [1, 1],
        purge: [1, 1],
      },
    });
  });
});
