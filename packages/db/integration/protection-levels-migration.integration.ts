import { afterAll, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'protection');
const folders = readdirSync(new URL('../migrations/', import.meta.url));
const migration = folders.find((folder) =>
  folder.endsWith('_pc_2_protection_levels'),
);
const validation = folders.find((folder) =>
  folder.endsWith('_pc_2_protection_checks_validated'),
);
if (!migration || !validation)
  throw new Error('Protection migrations are missing');
afterAll(() => scratch.drop());

test(
  'the protection migration preserves an existing friendship, request and notification preference',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const recipientUser = await f.user();
      const recipient = await f.actor(recipientUser);
      const requester = await f.actor();
      const friend = await f.actor();
      try {
        const requestedAt = new Date();
        for (const [counterpart, state] of [
          [requester, 'pending'],
          [friend, 'accepted'],
        ] as const) {
          const [low, high] = [recipient, counterpart].sort();
          await f.sql`insert into contact_pairs(low_actor_id, high_actor_id) values(${low},${high})`;
          await f.sql`insert into friendships(low_actor_id, high_actor_id, requester_actor_id, state, requested_at, accepted_at)
        values(${low},${high},${counterpart},${state},${requestedAt},${state === 'accepted' ? requestedAt : null})`;
        }
        const [low, high] = [recipient, requester].sort();
        const notification = createId();
        await f.sql`insert into notifications(id, user_id, kind, actor_id, friendship_low_actor_id, friendship_high_actor_id)
      values(${notification},${recipientUser},'friend_request_received',${requester},${low},${high})`;
        await f.sql`insert into notification_preferences(user_id,kind,channel,enabled)
      values(${recipientUser},'friend_request_received','email',false)`;

        await scratch.migrate((folder) => folder <= validation);
        expect<unknown>(
          await f.sql`select state from friendships where ${recipient} in (low_actor_id, high_actor_id) order by state`,
        ).toEqual([{ state: 'accepted' }, { state: 'pending' }]);
        expect<unknown>(
          await f.sql`select kind from notifications where id=${notification}`,
        ).toEqual([{ kind: 'friend_request_received' }]);
        expect<unknown>(
          await f.sql`select enabled from notification_preferences where user_id=${recipientUser}`,
        ).toEqual([{ enabled: false }]);
        expect<unknown>(
          await f.sql`select public.daisy_protection_level(${recipientUser}) as choice`,
        ).toEqual([{ choice: { level: 'independent' } }]);
        const checks =
          await f.sql`select convalidated from pg_constraint where conname in (
      'friendships_state', 'friendships_time', 'notification_preferences_pair_check',
      'notifications_kind_check', 'notifications_subject_check')`;
        expect<unknown>(checks).toEqual(
          Array.from({ length: 5 }, () => ({ convalidated: true })),
        );
      } finally {
        await f.sql`delete from contact_pairs where ${recipient} in (low_actor_id, high_actor_id)`;
      }
    });
  },
  ddlTimeoutMs,
);
