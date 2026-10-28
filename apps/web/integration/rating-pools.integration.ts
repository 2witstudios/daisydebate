import { requireTestServices } from '@daisy/config';
import { ratingLadders } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { inArena } from './ratings-arena';
import { withSql } from './fixtures';
requireTestServices(process.env);
setupRitewayBun();

test('one actor has three isolated pools and retry never crosses a pool', async () => {
  await inArena(async ({ actor, round, rate, seasonId }) => {
    const shared = await actor();
    const opponent = await actor();
    const rounds = await Promise.all(
      ratingLadders.map((ladder) =>
        round({
          ladder,
          affirmative: shared,
          negative: opponent,
          outcome: ladder === 'policy' ? 'negative' : 'affirmative',
        }),
      ),
    );
    await Promise.all(rounds.map(rate));
    const before = await withSql(
      (sql) =>
        sql`select ladder,rating,deviation,version from ratings where actor_id=${shared} and season_id=${seasonId} order by ladder`,
    );
    await Promise.all(rounds.flatMap((id) => [rate(id), rate(id)]));
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
        'the same two humans complete one result in each canonical ladder concurrently',
      should:
        'start each pool independently at1500 and update each once with Glicko2',
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
        [
          ['freestyle', 1, true],
          ['policy', 1, false],
          ['value', 1, true],
        ],
        ratingLadders.map((ladder) => [ladder, 1500, 'glicko2-v1']),
        before,
      ],
    });
  });
});
