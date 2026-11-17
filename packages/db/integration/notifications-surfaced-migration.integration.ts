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

const migration = '20261117031637_notifications';
const scratch = scratchDatabase(url, 'surfacedat');

afterAll(() => scratch.drop());

test(
  'the migration dates every stored notification as surfacing when it was written, and drops the challenge email choice (ADR 0144)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const member = await f.user();
      const debater = await f.actor();
      const roundId = await f.round();
      const id = createId();
      await f.insert('notifications', {
        id,
        user_id: member,
        kind: 'followed_debater_live',
        round_id: roundId,
        actor_id: debater,
        created_at: new Date('2026-01-02T03:04:05.000Z'),
      });
      // Main's Settings save wrote every pair, a challenge's email included.
      for (const [kind, channel] of [
        ['challenge_received', 'email'],
        ['challenge_received', 'in_app'],
        ['room_invitation', 'email'],
      ])
        await f.sql`insert into notification_preferences(user_id,kind,channel,enabled)
          values(${member},${kind},${channel},false)`;
      await scratch.migrate((folder) => folder <= migration);
      const kept = await f.sql`select kind,channel from notification_preferences
        where user_id=${member} order by kind,channel`;
      const [row] = await f.sql`select surfaced_at = created_at as same,
          digest_id is null as undigested
        from notifications where id=${id}`;
      assert({
        given: 'a notification written before the inbox could resurface one',
        should:
          'keep its place in the inbox: it surfaced when written, in no digest',
        actual: row,
        expected: { same: true, undigested: true },
      });
      assert({
        given: 'stored choices, one of them a challenge email',
        should:
          'drop only the challenge email choice, which no longer exists, and keep the rest',
        actual: kept.map(
          (choice: { kind: string; channel: string }) =>
            `${choice.kind}.${choice.channel}`,
        ),
        expected: ['challenge_received.in_app', 'room_invitation.email'],
      });
    });
  },
  ddlTimeoutMs,
);
