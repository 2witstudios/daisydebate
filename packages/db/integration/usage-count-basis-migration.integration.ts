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
const predecessor = '20261105041923_billing_usage_restoration';
const migration = '20261105051949_casual_judge_usage';
const source = await readFile(
  new URL(`../migrations/${migration}/migration.sql`, import.meta.url),
  'utf8',
);
const actorFk = 'usage_reservations_actor_id_actors_id_fkey';
const roundFk = 'usage_reservations_round_id_rounds_id_fkey';

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
    source: { kind: 'lifetime' },
    binds_free_judge: true,
    state: { kind: 'unknown', countedAt: '2026-10-01T00:00:01.000Z' },
  });
  return id;
}

test(
  '51949 counted-row rewrite preserves attribution with the exact nondeferred predecessor inventory',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'billingcountbasis');
    await scratch.create();
    try {
      await scratch.migrate((tag) => tag <= predecessor);
      await withFixture(scratch.url, async (f) => {
        const id = await counted(f);
        const fks =
          await f.sql`select conname as name,condeferrable as deferrable,condeferred as deferred,pg_get_constraintdef(oid) as definition
        from pg_constraint where conrelid='usage_reservations'::regclass and contype='f' order by conname`;
        const triggers =
          await f.sql`select case when t.tgisinternal then c.conname else t.tgname end as name,
        t.tgtype::int as type,t.tgdeferrable as deferrable,t.tginitdeferred as deferred,t.tgenabled as enabled
        from pg_trigger t left join pg_constraint c on c.oid=t.tgconstraint
        where t.tgrelid='usage_reservations'::regclass order by name,type`;
        assert({
          given:
            'the actual predecessor schema before 51949, including every usage trigger and FK',
          should:
            'have only immediate FKs and the enabled BEFORE UPDATE attribution guard, with no deferred event producer',
          actual: [fks, triggers],
          expected: [
            [
              {
                name: actorFk,
                deferrable: false,
                deferred: false,
                definition:
                  'FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE RESTRICT',
              },
              {
                name: roundFk,
                deferrable: false,
                deferred: false,
                definition:
                  'FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE',
              },
            ],
            [
              {
                name: 'usage_attribution_immutable',
                type: 19,
                deferrable: false,
                deferred: false,
                enabled: 'O',
              },
              ...[actorFk, roundFk].flatMap((name) =>
                [5, 17].map((type) => ({
                  name,
                  type,
                  deferrable: false,
                  deferred: false,
                  enabled: 'O',
                })),
              ),
            ],
          ],
        });
        const [before] =
          await f.sql`select * from usage_reservations where id=${id}`;
        await scratch.migrate((tag) => tag <= migration);
        const [after] =
          await f.sql`select * from usage_reservations where id=${id}`;
        assert({
          given:
            'a pre-existing counted row that actually matches the representation UPDATE',
          should:
            'add only its recorded-dispatch basis while preserving every original identity, count, source and binding',
          actual: after,
          expected: {
            ...before,
            state: { ...before.state, countBasis: 'dispatch_record' },
          },
        });
        const rejected = await sqlStateOf(() =>
          f.sql.begin(async (tx) => {
            await tx`set local role daisy_web`;
            await tx`update usage_reservations set source='{"kind":"beta","startsAt":"2026-10-01T00:00:00.000Z","endsAt":"2026-11-01T00:00:00.000Z"}' where id=${id}`;
          }),
        );
        const [guard] =
          await f.sql`select tgenabled from pg_trigger where tgrelid='usage_reservations'::regclass and tgname='usage_attribution_immutable'`;
        assert({
          given: 'the migrated row under the actual daisy_web role',
          should:
            'retain an enabled attribution guard rejecting an otherwise valid source mutation',
          actual: [
            guard.tgenabled,
            rejected,
            await f.sql`select * from usage_reservations where id=${id}`,
          ],
          expected: ['O', '23514', [after]],
        });
      });
    } finally {
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);

test(
  'a genuine deferred usage event makes PostgreSQL reject the same 51949 ENABLE TRIGGER',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'billingcountnegative');
    await scratch.create();
    try {
      await scratch.migrate((tag) => tag <= predecessor);
      await withFixture(scratch.url, async (f) => {
        const id = await counted(f);
        await f.sql`create function fixture_deferred_usage() returns trigger language plpgsql as $$ begin return NEW; end; $$`;
        await f.sql`create constraint trigger fixture_deferred_usage after update on usage_reservations
        deferrable initially deferred for each row execute function fixture_deferred_usage()`;
        const statements = source.split('--> statement-breakpoint');
        const enable = statements.findIndex((statement) =>
          statement.includes(
            'ALTER TABLE usage_reservations ENABLE TRIGGER usage_attribution_immutable;',
          ),
        );
        if (enable < 1)
          throw Error('Missing exact migration trigger restoration');
        let lastStatement = '';
        const code = await sqlStateOf(() =>
          f.sql.begin(async (tx) => {
            for (const statement of statements.slice(0, enable + 1)) {
              lastStatement = statement.trim();
              await tx.unsafe(statement);
            }
          }),
        );
        const [row] =
          await f.sql`select state from usage_reservations where id=${id}`;
        assert({
          given:
            'the identical migration prefix with a real queued deferred AFTER UPDATE event',
          should:
            'fail at the same ENABLE TRIGGER with object_in_use and roll back the rewrite',
          actual: [code, lastStatement, row.state],
          expected: [
            '55006',
            'ALTER TABLE usage_reservations ENABLE TRIGGER usage_attribution_immutable;',
            { kind: 'unknown', countedAt: '2026-10-01T00:00:01.000Z' },
          ],
        });
      });
    } finally {
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);
