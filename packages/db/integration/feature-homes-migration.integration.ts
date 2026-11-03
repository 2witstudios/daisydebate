import { afterAll } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261103035858_feature_homes';
const scratch = scratchDatabase(databaseUrl, 'featurehomesit');
afterAll(() => scratch.drop());

test(
  'a stored scheduled season closes, so the narrowed CHECK cannot refuse the deploy',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    const seed = (status: string) => ({
      id: createId(),
      name: status,
      starts_at: new Date('2026-11-03T00:00:00.000Z'),
      ends_at: null,
      status,
    });
    const scheduled = seed('scheduled');
    const active = seed('active');
    await withFixture(scratch.url, async (f) => {
      await f.insert('seasons', scheduled);
      await f.insert('seasons', active);
      await scratch.migrate((folder) => folder <= migration);
      const statuses = (await f.sql.unsafe(
        'select id, status from seasons where id = any($1)',
        [[scheduled.id, active.id]],
      )) as readonly { id: string; status: string }[];
      assert({
        given: 'a scheduled and an active season before the migration',
        should: 'close the scheduled one and leave the active one',
        actual: [
          statuses.find((row) => row.id === scheduled.id)?.status,
          statuses.find((row) => row.id === active.id)?.status,
        ],
        expected: ['closed', 'active'],
      });
    });
  },
  ddlTimeoutMs,
);
