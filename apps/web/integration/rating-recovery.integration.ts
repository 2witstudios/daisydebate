import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '@daisy/db';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRatingSweep } from '../src/features/ratings/sweep';
import { inArena, minute } from './ratings-arena';
import { testDatabaseUrl, withSql } from './fixtures';
requireTestServices(process.env);
setupRitewayBun();

test('real PostgreSQL recovery crosses full pages after unavailable season and reopens failed head', async () => {
  await inArena(
    async (arena) => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++)
        ids.push(
          await arena.round({
            affirmative: await arena.actor(),
            negative: await arena.actor(),
            outcome: i % 2 ? 'negative' : 'affirmative',
          }),
        );
      ids.sort();
      let db = createDatabase({ url: testDatabaseUrl, nextActorId: createId });
      const failures: string[] = [];
      const makeSweep = () =>
        createRatingSweep({
          database: db,
          ids: { next: createId },
          onFailure: (id) => {
            failures.push(id);
          },
        });
      try {
        const first = await makeSweep()({ limit: 2 });
        assert({
          given: 'two finalized results but no active season',
          should: 'retain failed rows and advance the bounded keyset',
          actual: [first, failures],
          expected: [{ afterId: ids[1], exhausted: false }, ids.slice(0, 2)],
        });
        await arena.season('active', minute(0));
        let cursor = first.afterId;
        for (;;) {
          const page = await makeSweep()({
            ...(cursor ? { afterId: cursor } : {}),
            limit: 2,
          });
          cursor = page.afterId;
          if (page.exhausted) break;
        }
        await db.close();
        db = createDatabase({ url: testDatabaseUrl, nextActorId: createId });
        // A separate worker process opens new connections and restarts at the failed head.
        const child = Bun.spawn(
          [
            'bun',
            new URL('./rating-recovery-worker.test-support.ts', import.meta.url)
              .pathname,
          ],
          { env: process.env, stdout: 'pipe', stderr: 'pipe' },
        );
        const [code, output] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
        ]);
        assert({
          given: 'a fresh worker process after activation',
          should: 'recover the failed first page without errors',
          actual: [code, JSON.parse(output).failures],
          expected: [0, 0],
        });
        await makeSweep()({ limit: 2 });
        const ledger = await withSql(
          (sql) =>
            sql`select round_id,count(*)::integer as count,bool_and(calculation_version='glicko2-v1') as real_policy from rating_changes where round_id in ${sql(ids)} group by round_id order by round_id`,
        );
        assert({
          given: 'five recovered results and a duplicate scan',
          should: 'commit exactly two Glicko2 postings per result',
          actual: ledger.map(
            (row: {
              round_id: string;
              count: number;
              real_policy: boolean;
            }) => [row.round_id, row.count, row.real_policy],
          ),
          expected: ids.map((id) => [id, 2, true]),
        });
        assert({
          given:
            'later pages posted and a new database client restarts from the beginning',
          should: 'post every outcome exactly once with the real Glicko policy',
          actual: await db.readUnratedRatingRounds({ limit: 10 }),
          expected: [],
        });
      } finally {
        await db.close();
      }
    },
    { season: false },
  );
});
