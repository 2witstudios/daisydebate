import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { inArena } from './ratings-arena';
import { withSql } from './fixtures';
requireTestServices(process.env);
setupRitewayBun();

test('one actor has one ladder pool and retry never posts twice', async () => {
  await inArena(async ({ actor, round, rate, seasonId }) => {
    const shared = await actor();
    const opponent = await actor();
    const roundId = await round({
      ladder: 'freestyle',
      affirmative: shared,
      negative: opponent,
      outcome: 'affirmative',
    });
    await Promise.all([rate(roundId), rate(roundId)]);
    const before = await withSql(
      (sql) =>
        sql`select ladder,rating,deviation,version from ratings where actor_id=${shared} and season_id=${seasonId} order by ladder`,
    );
    await Promise.all([rate(roundId), rate(roundId)]);
    const after = await withSql(
      (sql) =>
        sql`select ladder,rating,deviation,version from ratings where actor_id=${shared} and season_id=${seasonId} order by ladder`,
    );
    const posts = await withSql(
      (sql) =>
        sql`select ladder,rating_before,calculation_version from rating_changes where actor_id=${shared} order by ladder`,
    );
    assert({
      given:
        'the same two humans complete one Freestyle result rated concurrently and then retried',
      should:
        'start the Freestyle pool at 1500 and update it exactly once with Glicko2',
      actual: [
        before.map((r: { ladder: string; version: number; rating: number }) => [
          r.ladder,
          r.version,
          Number(r.rating) > 1500,
        ]),
        posts.map(
          (r: {
            ladder: string;
            rating_before: number;
            calculation_version: string;
          }) => [r.ladder, Number(r.rating_before), r.calculation_version],
        ),
        after,
      ],
      expected: [
        [['freestyle', 1, true]],
        [['freestyle', 1500, 'glicko2-v1']],
        before,
      ],
    });
  });
});
