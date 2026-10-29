import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const migration = await Bun.file(
  new URL(
    '../migrations/20261028224402_three_rating_ladders/migration.sql',
    import.meta.url,
  ),
).text();

for (const populated of ['ratings', 'rating_changes', 'rooms', 'rounds'])
  test(`populated ${populated} refuses the whole ladder migration unchanged`, async () => {
    const scoped = new SQL(url, { max: 1 });
    try {
      // Session-local legacy surfaces shadow public tables. The complete
      // migration runs transactionally; no current competitive row is touched.
      await scoped`create temporary table ratings(id text)`;
      await scoped`create temporary table rating_changes(id text)`;
      await scoped`create temporary table rooms(id text, competition_type text, preset_version integer)`;
      await scoped`create temporary table rounds(id text, competition_type text, preset_version integer, ladder_id text)`;
      await scoped.unsafe(
        `insert into ${populated}(id${populated === 'rooms' || populated === 'rounds' ? ',competition_type' : ''}) values ('preserved'${populated === 'rooms' || populated === 'rounds' ? ",'ranked'" : ''})`,
      );
      let refusal = '';
      try {
        await scoped.begin(async (tx) => {
          for (const statement of migration.split('--> statement-breakpoint'))
            if (statement.trim()) await tx.unsafe(statement);
        });
      } catch (error) {
        refusal = error instanceof Error ? error.message : '';
      }
      assert({
        given: `legacy competitive state in ${populated}`,
        should:
          'refuse before any DDL or data change, preserving the original row after rollback',
        actual: {
          refusal: refusal.includes(
            'Three ladders requires explicit disposition of existing rated state',
          ),
          rows: (await scoped.unsafe(`select id from ${populated}`)).map(
            (r: { id: string }) => r.id,
          ),
          activationColumn: (
            await scoped`select attname from pg_attribute where attrelid='pg_temp.ratings'::regclass and attname='activation_key'`
          ).length,
        },
        expected: { refusal: true, rows: ['preserved'], activationColumn: 0 },
      });
    } finally {
      await scoped.close();
    }
  });
