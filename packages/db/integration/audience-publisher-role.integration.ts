import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { audienceStateKey } from '../src/audience-publisher-store';
import { audienceSnapshotReads } from '../src/audience-snapshot-reads';
import { spectatorTimelineReads } from '../src/spectator-timeline-reads';
import { withFixture } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('the publisher reads what it publishes, and writes nothing else', async () => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    const can = async (table: string, privilege: string) =>
      (
        await sql`select has_table_privilege('daisy_audience_publisher', ${table}, ${privilege}) as ok`
      )[0].ok as boolean;
    const column = async (name: string) =>
      (
        await sql`select has_column_privilege('daisy_audience_publisher', 'users', ${name}, 'SELECT') as ok`
      )[0].ok as boolean;
    assert({
      given: 'the publisher role',
      should: 'read Rounds, never change one, and read no address from a user',
      actual: [
        await can('rounds', 'SELECT'),
        await can('rounds', 'UPDATE'),
        await can('messaging_messages', 'INSERT'),
        await can('broadcasts', 'INSERT'),
        await column('username'),
        await column('email'),
      ],
      expected: [true, false, false, false, true, false],
    });
  } finally {
    await sql.close();
  }
});

test('the publisher role can run both of its reads', async () => {
  await withFixture(databaseUrl, async (f) => {
    const format = await f.format();
    const room = await f.room(await f.actor(), format, {
      visibility: 'public',
    });
    const roundId = await f.round({
      room_id: room,
      room_config_snapshot: validConfig,
      visibility: 'public',
      format_id: format,
      rules_snapshot: validRules,
    });
    const client = new SQL(databaseUrl, { max: 1 });
    try {
      await client`set role daisy_audience_publisher`;
      const database = drizzle({ client });
      const timeline = await spectatorTimelineReads({
        database,
      }).readSpectatorTimeline({ roundId, horizonOf: () => Date.now() });
      const audience = await audienceSnapshotReads({
        database,
      }).readAudienceSnapshot({ roundId });
      assert({
        given: 'a public Round read under the role',
        should: 'answer both reads',
        actual: [timeline?.round.id, audience?.visibility],
        expected: [roundId, 'public'],
      });
    } finally {
      await client`reset role`;
      await client.close();
    }
  });
});

test('replacing a link moves the state', () => {
  const feed = createId();
  assert({
    given: 'one feed under a public Round, one link, and a replaced link',
    should: 'give each its own key, and the same key for the same input',
    actual: new Set([
      audienceStateKey(feed, null),
      audienceStateKey(feed, 'a'),
      audienceStateKey(feed, 'b'),
    ]).size,
    expected: 3,
  });
  assert({
    given: 'the same input twice',
    should: 'give one key',
    actual: audienceStateKey(feed, 'a'),
    expected: audienceStateKey(feed, 'a'),
  });
});
