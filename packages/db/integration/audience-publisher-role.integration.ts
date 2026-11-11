import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import type { RecordingStatus } from '@daisy/protocol';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  audienceStateKey,
  createAudiencePublisherStore,
} from '../src/audience-publisher-store';
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
        await can('messaging_messages', 'SELECT'),
        await can('messaging_channels', 'SELECT'),
        await can('spectator_chat_messages', 'SELECT'),
        await can('broadcasts', 'INSERT'),
        await column('username'),
        await column('email'),
      ],
      expected: [true, false, false, false, true, false, true, false],
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

test('the state stays while a viewer may wait for the Recording, no longer', async () => {
  await withFixture(databaseUrl, async (f) => {
    const format = await f.format();
    const actor = await f.actor();
    const store = createAudiencePublisherStore(databaseUrl);
    const now = new Date('2026-11-04T12:00:00.000Z');
    const stopped = new Date(now.getTime() - 20 * 60_000);
    try {
      const overWith = async (
        status: RecordingStatus | null,
        settledAt: Date = stopped,
        roundStatus: 'active' | 'completed' = 'completed',
        broadcastEnded = true,
      ) => {
        const roundId = await f.round({
          room_id: await f.room(actor, format, { visibility: 'public' }),
          room_config_snapshot: validConfig,
          visibility: 'public',
          format_id: format,
          rules_snapshot: validRules,
          ...(roundStatus === 'completed'
            ? {
                status: 'completed',
                current_stage: null,
                outcome: 'affirmative',
                started_at: stopped.toISOString(),
                completed_at: stopped.toISOString(),
                resolution: 'A resolution',
              }
            : {}),
        });
        const broadcastId = createId();
        await f.sql`insert into broadcasts (id,round_id,feed_key,release_policy,stopped_at,stop_reason,created_at)
          values (${broadcastId},${roundId},${createId()},${JSON.stringify({ kind: 'delay', delayMs: 15_000 })}::text::jsonb,${broadcastEnded ? stopped : null},${broadcastEnded ? 'policy_violation' : null},${stopped})`;
        if (status)
          await f.sql`insert into recordings (id,round_id,recording_class,status,eligibility,lifecycle,updated_at,deletion_due_at)
            values (${createId()},${roundId},'ranked',${status},
              jsonb_build_object('kind','ranked'),${JSON.stringify({ status })}::text::jsonb,${settledAt},
              ${status === 'removing' ? settledAt : null})`;
        const rows = await store.readPublishing({
          now,
          keepMs: 6 * 3_600_000,
          settledKeepMs: 10 * 60_000,
          limit: 10_000,
        });
        await f.sql`delete from recordings where round_id=${roundId}`;
        await f.sql`delete from broadcasts where id=${broadcastId}`;
        return rows.find((row) => row.broadcastId === broadcastId)?.over;
      };
      const justNow = new Date(now.getTime() - 60_000);
      assert({
        given: 'a Broadcast stopped 20 minutes ago, by its Recording status',
        should: 'keep it only while the Recording may still arrive',
        actual: {
          none: await overWith(null),
          processing: await overWith('processing'),
          ready: await overWith('ready'),
          failed: await overWith('failed'),
          taken_down: await overWith('taken_down'),
          removing: await overWith('removing'),
          removed: await overWith('removed'),
        },
        expected: {
          none: true,
          processing: false,
          ready: true,
          failed: true,
          taken_down: true,
          removing: true,
          removed: true,
        },
      });
      assert({
        given:
          'a Recording settling after the window, and a Round still running',
        should:
          'leave time to read the final state, and keep the running Round',
        actual: [
          await overWith('ready', justNow),
          await overWith(null, stopped, 'active'),
          await overWith(null, stopped, 'completed', false),
          await overWith('failed', stopped, 'completed', false),
        ],
        expected: [false, false, false, false],
      });
    } finally {
      await store.close();
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
