import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { settleAttendanceFixture } from './attendance-evaluator.test-support';
import { createAttendanceRatingSweep } from '../src/features/attendance/rating';
import { withAttendanceRound } from './attendance.test-support';
import { rateDebate, ratingPolicy } from '@daisy/debate-engine';
setupRitewayBun();
requireTestServices(process.env);

test('existing rating feature rediscovers only committed ranked RT forfeits and rates exactly once', async () => {
  for (const kind of ['ranked', 'casual', 'abandoned'] as const)
    await withAttendanceRound(async (input) => {
      const { f, attendance, roundId } = input;
      const cleanup = await settleAttendanceFixture(
        input,
        kind !== 'abandoned',
        kind !== 'casual',
      );
      try {
        const sweep = () =>
          createAttendanceRatingSweep({
            database: f.store,
            ids: { next: createId },
          })({ limit: 100 });
        await sweep();
        const before =
          await f.sql`select id from rating_changes where round_id=${roundId}`;
        const resolved = await attendance.evaluate(roundId);
        const committed = await f.store.getRound(roundId);
        await Promise.all([sweep(), sweep()]);
        const ledger: { rating_after: number; calculation_version: string }[] =
          await f.sql`select rating_before,rating_after,calculation_version from rating_changes where round_id=${roundId}`;
        assert({
          given: `${kind} historical actual speech evidence through real evaluator`,
          should:
            'commit shared engine outcome before rating and preserve no-ledger cases',
          actual: {
            before: before.length,
            decision: resolved?.decision,
            status: committed?.status,
            outcome: committed?.outcome,
            ledger: ledger.length,
            rediscover: await f.store.readUnratedAttendanceForfeits({
              limit: 100,
            }),
          },
          expected: {
            before: 0,
            decision: kind === 'abandoned' ? 'abandoned' : 'forfeit',
            status: kind === 'abandoned' ? 'abandoned' : 'completed',
            outcome: kind === 'abandoned' ? null : 'negative',
            ledger: kind === 'ranked' ? 2 : 0,
            rediscover: [],
          },
        });
        if (kind === 'ranked') {
          const expected = rateDebate({
            affirmative: { state: ratingPolicy.initial, lastRatedAt: null },
            negative: { state: ratingPolicy.initial, lastRatedAt: null },
            outcome: 'negative',
            occurredAt: committed!.completedAt!,
          });
          assert({
            given:
              'committed ranked RT forfeit followed by concurrent restart sweeps',
            should: 'write the existing engine calculation exactly once',
            actual: ledger
              .map((row) => ({
                rating: row.rating_after,
                version: row.calculation_version,
              }))
              .sort((a, b) => a.rating - b.rating),
            expected: [
              expected.affirmative.after.rating,
              expected.negative.after.rating,
            ]
              .sort((a, b) => a - b)
              .map((rating) => ({
                rating,
                version: expected.calculationVersion,
              })),
          });
        }
      } finally {
        await cleanup();
      }
    });
});
