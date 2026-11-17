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

const migration = '20261117022243_notifications';
const scratch = scratchDatabase(url, 'surfacedat');

afterAll(() => scratch.drop());

test(
  'the migration dates every stored notification as surfacing when it was written (ADR 0144)',
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
      await scratch.migrate((folder) => folder <= migration);
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
    });
  },
  ddlTimeoutMs,
);
