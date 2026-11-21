import { expect, test } from 'bun:test';
import type { SavepointSQL } from 'bun';
import { fixedClock } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import {
  notificationInboxOperations,
  withRolledBackDatabase,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { provisionalLinkPurposes } from '../src/features/auth/mail/provisional-mail';
import {
  createRetentionSweep,
  retentionTargets,
} from '../src/server/retention-sweep';
import { silentLogger } from '../src/server/test-loggers.test-support';

const { databaseUrl } = requireTestServices(process.env);
const day = 86_400_000;

test('the scheduled notification sweep drains bounded batches and keeps recent private notices', async () => {
  const at = new Date();
  const cutoff = new Date(at.getTime() - 90 * day).toISOString();
  const expired = new Date(at.getTime() - 91 * day);
  const recent = new Date(at.getTime() - day);
  const appDatabase = createDatabase({
    url: databaseUrl,
    nextActorId: createId,
  });
  try {
    await withRolledBackDatabase(databaseUrl, {
      seed: async (sql) => {
        const guardian = createId();
        const child = { user_id: createId(), actor_id: createId() };
        const senders = Array.from({ length: 502 }, (_, index) => ({
          user_id: createId(),
          actor_id: createId(),
          notice_id: createId(),
          read_at: index === 501 ? recent : expired,
        }));
        const people = JSON.stringify([child, ...senders]);
        const rows = JSON.stringify(senders);
        await sql`insert into users(id,username) values(${guardian},${guardian})`;
        await sql`insert into users(id,username)
          select user_id,user_id from jsonb_to_recordset(${people}::text::jsonb) as member(user_id text)`;
        await sql`insert into actors(id,kind,user_id)
          select actor_id,'human',user_id from jsonb_to_recordset(${people}::text::jsonb)
          as member(user_id text, actor_id text)`;
        await sql`insert into contact_pairs(low_actor_id,high_actor_id)
          select least(actor_id,${child.actor_id}),greatest(actor_id,${child.actor_id})
          from jsonb_to_recordset(${rows}::text::jsonb) as sender(actor_id text)`;
        await sql`insert into friendships(low_actor_id,high_actor_id,requester_actor_id,state,requested_at)
          select least(actor_id,${child.actor_id}),greatest(actor_id,${child.actor_id}),actor_id,'pending',${expired}
          from jsonb_to_recordset(${rows}::text::jsonb) as sender(actor_id text)`;
        await sql`insert into notifications(id,user_id,kind,actor_id,
          friendship_low_actor_id,friendship_high_actor_id,created_at,surfaced_at,read_at)
          select notice_id,${guardian},'friend_guardian_approval',${child.actor_id},
            least(actor_id,${child.actor_id}),greatest(actor_id,${child.actor_id}),
            ${expired},${expired},read_at
          from jsonb_to_recordset(${rows}::text::jsonb) as sender(actor_id text,notice_id text,read_at timestamptz)`;
        return { guardian, recentId: senders.at(-1)!.notice_id };
      },
      work: async (db, { guardian, recentId }, sql) => {
        const calls: Array<{ before: string; limit: number; count: number }> =
          [];
        const targets = retentionTargets({
          database: {
            ...appDatabase,
            purgeReadNotifications: (batch) =>
              db.transaction(async (tx) => {
                const { purgeReadNotifications } = notificationInboxOperations({
                  database: {
                    execute: tx.execute.bind(tx),
                    transaction: db.transaction,
                  },
                });
                const count = await purgeReadNotifications(batch);
                calls.push({ ...batch, count });
                return count;
              }),
          },
          redis: { sweepOnlinePresence: async () => 0 },
          provisionalLinks: provisionalLinkPurposes,
        }).filter(({ name }) => name === 'retention.notifications');
        expect<unknown>(await sql`select current_user as role`).toEqual([
          { role: 'daisy_web' },
        ]);
        const results = await createRetentionSweep({
          targets,
          clock: fixedClock(at.toISOString()),
          logger: silentLogger,
        }).run();
        expect(calls).toEqual([
          { before: cutoff, limit: 500, count: 500 },
          { before: cutoff, limit: 500, count: 1 },
        ]);
        expect(results).toEqual([
          {
            operation: 'retention.notifications',
            ok: true,
            drained: true,
            deleted: 501,
            batches: 2,
          },
        ]);
        expect<unknown>(
          await sql.savepoint(async (scoped: SavepointSQL) => {
            await scoped`select set_config('daisy.subject_scope', ${guardian}, true)`;
            return scoped`select id from notifications where user_id=${guardian}`;
          }),
        ).toEqual([{ id: recentId }]);
      },
    });
  } finally {
    await appDatabase.close();
  }
});
