import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture } from './constraint-helpers';
import { scratchDatabase } from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261103083747_round_audience_link';
const scratch = scratchDatabase(url, 'audiencelinkit');

afterAll(() => scratch.drop());

test('a Broadcast opened before the feed key keeps its objects’ address', async () => {
  await scratch.create();
  await scratch.migrate((folder) => folder < migration);
  await withFixture(scratch.url, async (f) => {
    const roundId = await f.round();
    const broadcastId = createId();
    await f.insert('broadcasts', {
      id: broadcastId,
      round_id: roundId,
      release_policy: { kind: 'delay', seconds: 60 },
    });
    await scratch.migrate((folder) => folder <= migration);
    const [row] =
      (await f.sql`select feed_key from broadcasts where id=${broadcastId}`) as {
        feed_key: string;
      }[];
    const [column] =
      (await f.sql`select is_nullable from information_schema.columns
      where table_name='broadcasts' and column_name='feed_key'`) as {
        is_nullable: string;
      }[];
    assert({
      given: 'a Broadcast whose objects sit under its id',
      should: 'take its id as its key, with the key then required',
      actual: [row?.feed_key, column?.is_nullable],
      expected: [broadcastId, 'NO'],
    });
  });
});
