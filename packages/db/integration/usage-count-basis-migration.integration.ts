import { readFile } from 'node:fs/promises';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sqlStateOf, withFixture, type Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261107080513_fair_midnight';
const source = await readFile(
  new URL(`../migrations/${migration}/migration.sql`, import.meta.url),
  'utf8',
);

async function counted(f: Fixture) {
  const actorId = await f.actor();
  const roundId = await f.round({ created_by_actor_id: actorId });
  const id = createId();
  await f.insert('usage_reservations', {
    id,
    actor_id: actorId,
    round_id: roundId,
    kind: 'ai_round',
    reserved_at: new Date('2026-10-01T00:00:00.000Z'),
    counted_at: new Date('2026-10-01T00:00:01.000Z'),
  });
  return id;
}

test(
  'canonical main99 count conversion preserves original count and installs immutable attribution',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'can7vbrip0jcount');
    await scratch.create();
    try {
      await scratch.migrate((tag) => tag < migration);
      await withFixture(scratch.url, async (f) => {
        const id = await counted(f);
        const [before] =
          await f.sql`select id,actor_id,round_id,reserved_at,counted_at from usage_reservations where id=${id}`;
        await scratch.migrate(() => true);
        const [after] =
          await f.sql`select id,actor_id,round_id,reserved_at,source,state from usage_reservations where id=${id}`;
        const rejected = await sqlStateOf(() =>
          f.sql.begin(async (tx) => {
            await tx`set local role daisy_web`;
            await tx`update usage_reservations set source='{"kind":"lifetime"}'::jsonb where id=${id}`;
          }),
        );
        const [guard] =
          await f.sql`select tgenabled from pg_trigger where tgrelid='usage_reservations'::regclass and tgname='usage_attribution_immutable'`;
        assert({
          given:
            'an actual counted bot reservation in populated main99 followed by canonical migration under current role',
          should:
            'retain original identity/time/beta period and dispatch basis, reject source mutation and leave the guard enabled',
          actual: [after, rejected, guard.tgenabled],
          expected: [
            {
              id: before.id,
              actor_id: before.actor_id,
              round_id: before.round_id,
              reserved_at: before.reserved_at,
              source: {
                kind: 'beta',
                startsAt: '2026-10-01T00:00:00.000Z',
                endsAt: '2026-11-01T00:00:00.000Z',
              },
              state: {
                kind: 'unknown',
                countedAt: '2026-10-01T00:00:01.000000Z',
                countBasis: 'dispatch_record',
              },
            },
            '23514',
            'O',
          ],
        });
      });
    } finally {
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);

for (const flush of [false, true])
  test(
    `canonical conversion ${flush ? 'flushes' : 'requires flushing'} actual deferred usage events before DDL`,
    async () => {
      const scratch = scratchDatabase(databaseUrl, 'can7vbrip0jflush');
      await scratch.create();
      try {
        await scratch.migrate((tag) => tag < migration);
        await withFixture(scratch.url, async (f) => {
          const id = await counted(f);
          await f.sql
            .unsafe(`CREATE FUNCTION canonical_fixture_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$;
        CREATE CONSTRAINT TRIGGER canonical_fixture_event AFTER UPDATE ON usage_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION canonical_fixture_event();`);
          const body = flush
            ? source
            : source.replaceAll('SET CONSTRAINTS ALL IMMEDIATE;', '');
          const state = await sqlStateOf(() =>
            f.sql.begin(async (tx) => {
              for (const statement of body.split('--> statement-breakpoint'))
                if (statement.trim()) await tx.unsafe(statement);
            }),
          );
          const [row] =
            await f.sql`select count(*)::int as count from usage_reservations where id=${id}`;
          assert({
            given: `${flush ? 'unchanged canonical SQL' : 'a scratch-only control removing every flush'} with real deferred UPDATE events on populated main99`,
            should: flush
              ? 'complete with the original row retained, without any checker waiver'
              : 'refuse pending-event DDL and roll back while preserving the original row',
            actual: [state, row.count],
            expected: [flush ? 'accepted' : '55006', 1],
          });
        });
      } finally {
        await scratch.drop();
      }
    },
    ddlTimeoutMs,
  );
