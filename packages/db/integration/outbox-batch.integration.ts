import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { appendOutboxEvents } from '../src/outbox';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('a batch past one insert is written whole, in order, and rejected whole when one row is not storable', async () => {
  await withFixture(databaseUrl, async (f) => {
    const actorId = createId();
    const topic = `user:${actorId}:inbox`;
    const signal = (id: string) => ({
      topic,
      kind: 'user.notification-delivered' as const,
      version: 1,
      payload: {
        entityVersion: 1,
        kind: 'user.notification-delivered' as const,
        ids: [id],
        notificationType: 'recording_ready' as const,
        occurredAt: '2026-11-16T12:00:00.000Z',
      },
    });
    const ids = Array.from({ length: 2_345 }, () => createId());
    const database = drizzle({ client: f.sql });
    try {
      await database.transaction((tx) =>
        appendOutboxEvents(tx, ids.map(signal)),
      );
      const stored = (await f.sql`select payload->'ids'->>0 as id from outbox
        where topic=${topic} order by seq`) as { id: string }[];
      const refused = await database
        .transaction((tx) =>
          appendOutboxEvents(tx, [
            signal(createId()),
            { ...signal(createId()), topic: 'round:not-a-room' },
          ]),
        )
        .then(
          () => 'written',
          () => 'refused',
        );
      const [after] = (await f.sql`select count(*)::int as n from outbox
        where topic=${topic}`) as { n: number }[];
      assert({
        given:
          'more rows than one insert holds, then a batch with one row not storable on its topic',
        should: 'write every row of the first in order, and none of the second',
        actual: {
          count: stored.length,
          ordered: stored.map((row) => row.id).join() === ids.join(),
          refused,
          after: after!.n,
        },
        expected: {
          count: 2_345,
          ordered: true,
          refused: 'refused',
          after: 2_345,
        },
      });
    } finally {
      await f.sql`delete from outbox where topic=${topic}`;
    }
  });
});
