import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createMessagingTestFixture } from '../src/messaging/test-fixture';
import { withFixture } from './constraint-helpers';
import { readCurrentProjection } from './observation.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('channel bodies count reactions per message and own reactions are read per viewer window', async () => {
  await withFixture(url, async (f) => {
    const fixture = await createMessagingTestFixture(f.sql),
      db = drizzle({ client: f.sql });
    const kept = createId(),
      removed = createId();
    try {
      await f.sql`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at,removed_at) values
        (${kept},${fixture.channelId},${fixture.actorId},1,1,'Kept','2026-10-09T18:00:00.000Z',null),
        (${removed},${fixture.channelId},${fixture.actorId},2,2,null,'2026-10-09T18:00:00.000Z','2026-10-09T18:01:00.000Z')`;
      await f.sql`insert into messaging_reactions(channel_id,message_id,actor_id,reaction) values
        (${fixture.channelId},${kept},${fixture.actorId},'like'),
        (${fixture.channelId},${kept},${fixture.otherActorId},'like'),
        (${fixture.channelId},${kept},${fixture.actorId},'heart')`;
      const page = await readCurrentProjection(
        db,
        { kind: 'channel', id: fixture.channelId },
        { after: null, limit: 50 },
      );
      assert({
        given: 'a kept message with three reactions and a removed message',
        should:
          'count each reaction once per message in reaction order and give removed messages none',
        actual: page.rows.map((row) => [row.id, row.reactions]),
        expected: [
          [removed, []],
          [
            kept,
            [
              { reaction: 'heart', count: 1 },
              { reaction: 'like', count: 2 },
            ],
          ],
        ],
      });
      const own = await f.sql.begin(async (tx) => {
        await tx`set local role daisy_realtime`;
        return tx`select binding, message_id as "messageId", reaction from public.daisy_observation_own_reactions(${JSON.stringify(
          [
            {
              channel: fixture.channelId,
              actor: fixture.actorId,
              before: null,
              limit: 50,
            },
            {
              channel: fixture.channelId,
              actor: fixture.otherActorId,
              before: null,
              limit: 50,
            },
            {
              channel: fixture.channelId,
              actor: fixture.actorId,
              before: 1,
              limit: 50,
            },
          ],
        )}::text::jsonb)`;
      });
      assert({
        given: 'three viewer windows, the last ending before the kept message',
        should:
          'return each viewer only their own reactions inside their window',
        actual: own.map(
          (row: { binding: number; messageId: string; reaction: string }) => [
            row.binding,
            row.messageId,
            row.reaction,
          ],
        ),
        expected: [
          [0, kept, 'heart'],
          [0, kept, 'like'],
          [1, kept, 'like'],
        ],
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
