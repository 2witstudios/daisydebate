import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { observationProjectionRowBytes } from '@daisy/protocol';
import { withFixture } from './constraint-helpers';
import { readCurrentProjection } from './observation.test-support';
import { createMessagingTestFixture } from '../src/messaging/test-fixture';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

test('channel projection returns the complete byte-bounded descending prefix and its continuation', async () => {
  await withFixture(url, async (f) => {
    const fixture = await createMessagingTestFixture(f.sql),
      db = drizzle({ client: f.sql });
    try {
      // Multibyte text makes the byte budget, not the item limit, decide the cut.
      const large = 'é'.repeat(Math.floor(observationProjectionRowBytes / 4));
      const texts = ['oldest', large, large, 'newest'];
      for (const [index, text] of texts.entries())
        await f.sql`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values(${createId()},${fixture.channelId},${fixture.actorId},${index + 1},${index + 1},${text},'2026-10-09T18:00:00.000Z')`;
      const resource = { kind: 'channel' as const, id: fixture.channelId };
      const read = (after: number | null, limit: number) =>
        readCurrentProjection(db, resource, { after, limit });
      const shape = (page: Awaited<ReturnType<typeof read>>) => ({
        sequences: page.rows.map((row) => row.sequence),
        continuation: page.continuation,
        withinBudget: bytes(page.rows) <= observationProjectionRowBytes,
      });
      assert({
        given: 'more older rows than the item limit',
        should: 'continue from the last included sequence',
        actual: shape(await read(null, 1)),
        expected: { sequences: [4], continuation: 4, withinBudget: true },
      });
      assert({
        given: 'rows whose cumulative UTF-8 JSON bytes exceed the budget',
        should:
          'return only the complete prefix that fits and continue from its last row',
        actual: shape(await read(null, 50)),
        expected: { sequences: [4, 3], continuation: 3, withinBudget: true },
      });
      assert({
        given: 'a window that reaches the oldest row',
        should: 'report no continuation',
        actual: shape(await read(3, 50)),
        expected: { sequences: [2, 1], continuation: null, withinBudget: true },
      });
      assert({
        given: 'a window past the oldest row',
        should: 'return an empty page with no continuation',
        actual: shape(await read(1, 50)),
        expected: { sequences: [], continuation: null, withinBudget: true },
      });
      await f.sql`update messaging_messages set text=${'x'.repeat(observationProjectionRowBytes)} where channel_id=${fixture.channelId} and sequence=4`;
      await assertRejects({
        given: 'a newest row that alone exceeds the byte budget',
        should:
          'refuse the page as unavailable rather than skip or truncate it',
        actual: () => read(null, 50),
        code: 'INFRASTRUCTURE',
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
