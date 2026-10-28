import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withSeasons } from '../src/seasons';
import { withRatings, ledgerOf } from './rating-fixtures';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

/** Wait for an observed lock dependency, bounded by5s; elapsed time proves nothing. */
async function blockedBehind(
  observer: SQL,
  blockerPid: number,
): Promise<number> {
  const until = performance.now() + 5000;
  while (performance.now() < until) {
    const [row] =
      await observer`select pid from pg_stat_activity where datname=current_database() and ${blockerPid}=any(pg_blocking_pids(pid)) limit 1`;
    if (row) return row.pid as number;
    await Bun.sleep(5);
  }
  throw Error('Expected database lock dependency was not observed');
}

async function holdRatingKey(actorId: string) {
  const client = new SQL(url, { max: 1 });
  const ready = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const work = client.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(59090,hashtext(${'freestyle:' + actorId}))`;
    const [row] = await tx`select pg_backend_pid() as pid`;
    ready.resolve(row!.pid as number);
    await release.promise;
  });
  return {
    pid: await ready.promise,
    release: () => release.resolve(),
    finish: async () => {
      await work;
      await client.close();
    },
  };
}

test('rating-held Round interoperates with the real account/erasure fence without reverse acquisition', async () => {
  await withRatings(url, async ({ fixture, rate, seated }) => {
    const round = await seated();
    const blocker = await holdRatingKey(round.affirmative);
    const writer = new SQL(url, { max: 1 });
    let posting: ReturnType<typeof rate> | undefined;
    let erasing: Promise<unknown> | undefined;
    try {
      posting = rate(round.roundId);
      const ratingPid = await blockedBehind(fixture.sql, blocker.pid);
      const fenced = Promise.withResolvers<void>();
      erasing = writer.begin(async (tx) => {
        await tx`select * from public.daisy_authorization_accounts_v2(array[${round.affirmative},${round.negative}]::text[],null::text,true)`;
        fenced.resolve();
        await tx`select id from rounds where id=${round.roundId} for no key update`;
        await tx`update users set deleted_at=clock_timestamp(),email_verified=false,version=version+1 where id in (select user_id from actors where id in (${round.affirmative},${round.negative}))`;
      });
      await fenced.promise;
      await blockedBehind(fixture.sql, ratingPid);
      blocker.release();
      const result = await posting;
      await erasing;
      const [closed] =
        await fixture.sql`select count(*)::int as n from users where deleted_at is not null and id in (select user_id from actors where id in (${round.affirmative},${round.negative}))`;
      assert({
        given:
          'rating holds Round/season while an account-fenced erasure writer waits on that Round',
        should:
          'commit both without shared actor/account lock reversal and retain atomic competitive postings',
        actual: [
          result.kind,
          (await ledgerOf(fixture, round.roundId)).length,
          closed!.n,
        ],
        expected: ['rated', 2, 2],
      });
    } finally {
      blocker.release();
      await Promise.allSettled([posting, erasing]);
      await blocker.finish();
      await writer.close();
    }
  });
});

test('season closure waits for an in-flight posting, then later postings refuse unchanged', async () => {
  await withRatings(url, async ({ fixture, rate, seated }) => {
    const round = await seated();
    const blocker = await holdRatingKey(round.affirmative);
    let posting: ReturnType<typeof rate> | undefined;
    let closing: Promise<unknown> | undefined;
    try {
      posting = rate(round.roundId);
      const ratingPid = await blockedBehind(fixture.sql, blocker.pid);
      closing = withSeasons(url, (s) =>
        s.closeSeason({
          id: round.seasonId,
          endsAt: new Date('2026-12-01T00:00:00.000Z'),
        }),
      );
      await blockedBehind(fixture.sql, ratingPid);
      blocker.release();
      const result = await posting;
      await closing;
      const later = await seated({ affirmative: round.affirmative });
      await assertRejects({
        given: 'a new posting after the shared season closes',
        should: 'refuse without invoking unapproved carry-over',
        actual: () => rate(later.roundId),
        code: 'CONFLICT',
      });
      assert({
        given: 'a committed close concurrent with an already locked posting',
        should: 'retain the original two changes and no late-season write',
        actual: [
          result.kind,
          (await ledgerOf(fixture, round.roundId)).length,
          (await ledgerOf(fixture, later.roundId)).length,
        ],
        expected: ['rated', 2, 0],
      });
    } finally {
      blocker.release();
      await Promise.allSettled([posting, closing]);
      await blocker.finish();
    }
  });
});
