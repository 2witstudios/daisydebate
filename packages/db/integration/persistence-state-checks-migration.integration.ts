import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { drizzle } from 'drizzle-orm/bun-sql';
import { recordingOperations } from '../src/recording-operations';
import { rejectedBy, withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const added = '20261111193716_persistence_state_checks';
const validated = '20261111193718_persistence_state_checks_validated';
const scratch = scratchDatabase(url, 'statechecks');

afterAll(() => scratch.drop());

const checks = [
  'broadcasts_completed_check',
  'broadcasts_egress_check',
  'broadcasts_feed_withdrawal_requested_check',
  'broadcasts_feed_withdrawn_check',
  'broadcasts_observer_revoked_check',
  'broadcasts_stop_reason_check',
  'moderation_actions_ends_after_start_check',
  'moderation_actions_lifted_after_start_check',
  'recordings_deletion_due_check',
] as const;

/** Each new CHECK and whether PostgreSQL has validated it against stored rows. */
const validity = async (sql: SQL) => {
  const rows = (await sql`select conname, convalidated from pg_constraint
    where conname in ${sql([...checks])} order by conname`) as {
    conname: string;
    convalidated: boolean;
  }[];
  return Object.fromEntries(rows.map((row) => [row.conname, row.convalidated]));
};

test('a database with no violating row ends with every new CHECK validated', async () => {
  const sql = new SQL(url, { max: 1 });
  try {
    assert({
      given: 'the committed migrations applied to a database with no rows',
      should: 'leave all nine constraints validated',
      actual: await validity(sql),
      expected: Object.fromEntries(checks.map((name) => [name, true])),
    });
  } finally {
    await sql.close();
  }
});

test(
  'stored rows that break a new CHECK neither refuse the migration nor escape it afterwards',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < added);
    await withFixture(scratch.url, async (f) => {
      const userId = await f.user();
      const roundId = await f.round();
      const broadcastId = createId();
      const recordingId = createId();
      const at = '2026-11-02T00:00:00.000Z';
      // What the schema before allowed: complete with no stream end or stop,
      // a failure counted after the revocation landed, a suspension that ended
      // before it began, a removal with nothing due.
      await f.sql`insert into broadcasts (id, round_id, feed_key, release_policy, completed_at, observer_revoked_at, revocation_failures)
        values (${broadcastId}, ${roundId}, ${createId()}, '{"kind":"delay","seconds":60}'::jsonb, ${at}::timestamptz, ${at}::timestamptz, 2)`;
      await f.sql`insert into moderation_actions (id, user_id, kind, starts_at, ends_at, operator_ref)
        values (${createId()}, ${userId}, 'suspension', ${at}::timestamptz, ${at}::timestamptz - interval '1 day', 'op')`;
      await f.sql`insert into recordings (id, round_id, recording_class, eligibility, status, lifecycle)
        values (${recordingId}, ${roundId}, 'casual',
          jsonb_build_object('kind', 'host_opt_in', 'hostActorId', ${createId()}::text), 'removing',
          ${JSON.stringify({ status: 'removing', cause: 'moderation', requestedAt: at })}::text::jsonb)`;
      try {
        await scratch.migrate((folder) => folder <= validated);
        const afterMigration = await validity(f.sql);
        const newWrites = [
          await rejectedBy(
            () =>
              f.sql`insert into moderation_actions (id, user_id, kind, starts_at, ends_at, operator_ref)
                values (${createId()}, ${userId}, 'suspension', ${at}::timestamptz, ${at}::timestamptz, 'op')`,
          ),
          // Any write to a stored violation must repair it.
          await rejectedBy(
            () =>
              f.sql`update broadcasts set next_segment = 1 where id = ${broadcastId}`,
          ),
          await rejectedBy(
            () =>
              f.sql`update broadcasts set stream_ended_at = ${at}::timestamptz where id = ${broadcastId}`,
          ),
        ];
        // The sweep's own writer must still take the stored removal.
        const claimed = await recordingOperations({
          database: drizzle({ client: f.sql }),
        }).claimRecordingDeletions({
          owner: 'w',
          // The repair made it due at the migration's own clock.
          now: new Date(Date.now() + 60_000).toISOString(),
          leaseUntil: new Date(Date.now() + 120_000).toISOString(),
          limit: 100,
        });
        const [counted] =
          await f.sql`select revocation_failures as failures from broadcasts where id = ${broadcastId}`;
        assert({
          given:
            'the two stored states with one right repair: a removal with nothing due and a failure counted after its revocation',
          should:
            'repair both in the migration, so the deletion sweep leases the removal and the count is zero',
          actual: [
            claimed.map((claim) => claim.record.id).includes(recordingId),
            counted?.failures,
          ],
          expected: [true, 0],
        });
        assert({
          given:
            'a completed Broadcast with no stream end and a late-counted failure, a suspension ending before its start and a removal with nothing due, stored before the migration',
          should:
            'apply both folders, repair what has one repair, leave only the two other broken constraints unvalidated, refuse new violations, and accept the write that repairs a stored one',
          actual: { afterMigration, newWrites },
          expected: {
            afterMigration: {
              broadcasts_completed_check: false,
              broadcasts_egress_check: true,
              broadcasts_feed_withdrawal_requested_check: true,
              broadcasts_feed_withdrawn_check: true,
              broadcasts_observer_revoked_check: true,
              broadcasts_stop_reason_check: true,
              moderation_actions_ends_after_start_check: false,
              moderation_actions_lifted_after_start_check: true,
              recordings_deletion_due_check: true,
            },
            newWrites: [
              'moderation_actions_ends_after_start_check',
              'broadcasts_completed_check',
              null,
            ],
          },
        });
      } finally {
        await f.sql`delete from recordings where id = ${recordingId}`;
        await f.sql`delete from broadcasts where id = ${broadcastId}`;
        await f.sql`delete from moderation_actions where user_id = ${userId}`;
      }
    });
  },
  ddlTimeoutMs,
);
