import { afterAll } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { validConfig } from './round-fixtures';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261103015125_round_owns_opening';
const scratch = scratchDatabase(databaseUrl, 'roundopeningit');
afterAll(() => scratch.drop());

test(
  'the migration settles scheduled Rounds and restarts Rooms that had begun a pre-round',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const actor = await f.actor();
      const format = await f.format();
      const scheduled = async (createdAt: Date, inRoom = true) =>
        f.round({
          created_by_actor_id: actor,
          format_id: format,
          created_at: createdAt,
          ...(inRoom
            ? {
                room_id: await f.room(actor, format, { status: 'started' }),
                room_config_snapshot: validConfig,
                visibility: 'public',
              }
            : {}),
        });
      const stale = await scheduled(new Date(Date.now() - 16 * 60_000));
      const fresh = await scheduled(new Date());
      const proof = await scheduled(new Date(), false);
      const started = await f.round({
        created_by_actor_id: actor,
        format_id: format,
        status: 'active',
        current_stage: 'countdown',
        started_at: new Date(),
      });
      const fixedPrep = await f.room(actor, format, {
        status: 'assembling',
        prep_started_at: new Date(),
        prep_remaining_ms: 60_000,
      });
      const untouched = await f.room(actor, format, { status: 'assembling' });
      const version = async (id: string) =>
        (await f.sql`select version, topic from rooms where id = ${id}`)[0];
      const before = await version(fixedPrep);

      await scratch.migrate((folder) => folder <= migration);
      await scratch.migrate((folder) => folder <= migration);

      const statuses =
        await f.sql`select id, status, current_stage, started_at is not null as started, completed_at is not null as completed from rounds where id in ${f.sql([stale, fresh, started, proof])}`;
      const of = (id: string) =>
        statuses.find((r: { id: string }) => r.id === id);
      const tables =
        await f.sql`select table_name from information_schema.tables where table_name like 'room_resolution_%'`;
      const columns =
        await f.sql`select column_name from information_schema.columns where table_name = 'rooms' and column_name like 'prep_%'`;
      assert({
        given: 'a stale and a fresh scheduled Round and a running one',
        should:
          'abandon the one past the old horizon, start the fresh one and leave the running one',
        actual: [
          [of(stale)?.status, of(stale)?.completed],
          [of(fresh)?.status, of(fresh)?.current_stage, of(fresh)?.started],
          of(started)?.status,
          of(proof)?.status,
        ],
        expected: [
          ['abandoned', true],
          ['active', 'countdown', true],
          'active',
          'abandoned',
        ],
      });
      assert({
        given: 'an open Room that had started prep, and one that had not',
        should:
          'bump the first so its Ready leases no longer count, keep its fixed topic, and leave the other',
        actual: [
          (await version(fixedPrep))?.version,
          (await version(fixedPrep))?.topic,
          (await version(untouched))?.version,
        ],
        expected: [before?.version + 1, before?.topic, 1],
      });
      assert({
        given: 'the schema after the move',
        should: 'hold no Room draw tables or prep columns',
        actual: [tables.length, columns.length],
        expected: [0, 0],
      });
      const refused =
        await f.sql`update rounds set status = 'active', resolution = null, current_stage = 'countdown', started_at = now() where id = ${stale}`.then(
          () => 'accepted',
          () => 'refused',
        );
      assert({
        given: 'an active Round with no resolution',
        should: 'be refused by the lifecycle CHECK',
        actual: refused,
        expected: 'refused',
      });
    });
  },
  ddlTimeoutMs,
);
