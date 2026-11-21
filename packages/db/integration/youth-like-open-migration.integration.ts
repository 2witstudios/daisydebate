import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261121020535_youth_like_open_and_reuse';
const scratch = scratchDatabase(url, 'youthopen');

afterAll(() => scratch.drop());

test(
  'the migration retires Youth-only state: a private stop reads technical, Share publicly notices go (ADR 0161)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const userId = await f.user();
      const actorId = await f.actor(userId);
      const roundId = await f.round();
      const youthStop = createId();
      const operatorStop = createId();
      for (const [id, reason] of [
        [youthStop, 'youth_round_private'],
        [operatorStop, 'policy_violation'],
      ] as const) {
        const other = reason === 'policy_violation' ? await f.round() : roundId;
        await f.sql`insert into broadcasts (id, round_id, feed_key, release_policy, stopped_at, stop_reason)
          values (${id}, ${other}, ${createId()}, ${{ kind: 'delay', seconds: 60 }}, now(), ${reason})`;
      }
      const published = createId();
      const ready = createId();
      await f.sql`insert into notifications (id, user_id, kind, round_id, actor_id)
        values (${published}, ${userId}, 'youth_round_published', ${roundId}, ${actorId}),
               (${ready}, ${userId}, 'recording_ready', ${roundId}, null)`;
      await f.sql`insert into notification_preferences (user_id, kind, channel, enabled)
        values (${userId}, 'youth_round_published', 'in_app', false),
               (${userId}, 'recording_ready', 'in_app', false),
               (${userId}, 'dm_request', 'email', false)`;
      await f.sql`insert into youth_round_publications (round_id, published_by_user_id, published_at)
        values (${roundId}, ${userId}, now())`;

      await scratch.migrate((folder) => folder <= migration);

      const stops =
        await f.sql`select id, stop_reason, stopped_at is not null as stopped
        from broadcasts where id in ${f.sql([youthStop, operatorStop])} order by stop_reason`;
      const notices =
        await f.sql`select id from notifications where user_id = ${userId} order by id`;
      const preferences =
        await f.sql`select kind from notification_preferences where user_id = ${userId} order by kind`;
      const [table] =
        await f.sql`select to_regclass('youth_round_publications') is null as dropped`;
      assert({
        given:
          'a Broadcast stopped as youth_round_private, an operator stop, a Share publicly notice and preference beside a Recording one, and a publication',
        should:
          'read the private stop as technical and keep it stopped, keep the operator stop, drop the Share publicly notice and preference, and drop the table',
        actual: {
          stops: [...stops],
          notices: notices.map((row: { id: string }) => row.id),
          preferences: preferences.map((row: { kind: string }) => row.kind),
          dropped: table!.dropped,
        },
        expected: {
          stops: [
            {
              id: operatorStop,
              stop_reason: 'policy_violation',
              stopped: true,
            },
            { id: youthStop, stop_reason: 'technical', stopped: true },
          ],
          notices: [ready],
          preferences: ['dm_request', 'recording_ready'],
          dropped: true,
        },
      });
    });
  },
  ddlTimeoutMs,
);
