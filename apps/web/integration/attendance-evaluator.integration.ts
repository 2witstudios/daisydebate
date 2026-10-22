import { buildDebateTopic } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { withAttendanceRound } from './attendance.test-support';
import { settleAttendanceFixture } from './attendance-evaluator.test-support';
import { withOutboxInsertBlockedForTopic } from './auth-outbox-helpers';
setupRitewayBun();
requireTestServices(process.env);

test('competing attendance sweeps commit one shared-engine decision and exactly one durable announcement', async () =>
  withAttendanceRound(async (input) => {
    const { f, attendance, roundId } = input;
    const cleanup = await settleAttendanceFixture(input, true, false);
    try {
      const before =
        await f.sql`select seq from outbox where topic=${buildDebateTopic(roundId)}`;
      const results = await Promise.allSettled([
        attendance.evaluate(roundId),
        attendance.evaluate(roundId),
      ]);
      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejected = results.filter((result) => result.status === 'rejected');
      const [facts] =
        await f.sql`select (select count(*)::int from round_attendance_adjudications where round_id=${roundId}) as decisions,(select count(*)::int from round_commands where round_id=${roundId} and type='adjudicate') as receipts,(select count(*)::int from outbox where topic=${buildDebateTopic(roundId)}) as announcements`;
      assert({
        given:
          'two actual same-Round evaluator transactions with settled historical evidence',
        should:
          'serialize one decision, ledger receipt and shared-engine announcement',
        actual: {
          fulfilledDecisions: fulfilled.map((result) => result.value?.decision),
          rejected: rejected.length,
          ...facts,
        },
        expected: {
          fulfilledDecisions: ['forfeit'],
          rejected: 1,
          decisions: 1,
          receipts: 1,
          announcements: before.length + 1,
        },
      });
      await assertRejects({
        given: 'the losing evaluator after fresh terminal fence',
        should: 'refuse without revising the result',
        actual: async () => {
          throw rejected[0]!.reason;
        },
        code: 'CONFLICT',
      });
    } finally {
      await cleanup();
    }
  }));

test('failed shared announcement rolls back adjudication lifecycle, receipt, speaking closure and capture anchor', async () =>
  withAttendanceRound(async (input) => {
    const { f, attendance, roundId } = input;
    const cleanup = await settleAttendanceFixture(input, true, false);
    try {
      const before = await f.store.getRound(roundId);
      const snapshot = () =>
        f.sql`select (select count(*)::int from round_attendance_adjudications where round_id=${roundId}) as decisions,(select count(*)::int from round_commands where round_id=${roundId} and type='adjudicate') as receipts,(select count(*)::int from outbox where topic=${buildDebateTopic(roundId)}) as announcements,(select final_segment_ended_at::text from rounds where id=${roundId}) as anchor`;
      const prior = await snapshot();
      await withOutboxInsertBlockedForTopic(
        buildDebateTopic(roundId),
        async () => {
          await assertRejects({
            given:
              'actual PG outbox rejection after proposed competitive projection',
            should: 'abort the evaluator transaction',
            actual: () => attendance.evaluate(roundId),
            code: 'INFRASTRUCTURE',
          });
        },
      );
      assert({
        given: 'the actual writer transaction failed',
        should:
          'preserve the entire shared Round and all durable receipt/announcement facts',
        actual: {
          round: await f.store.getRound(roundId),
          facts: await snapshot(),
        },
        expected: { round: before, facts: prior },
      });
      assert({
        given: 'the owned outbox fault is removed',
        should: 'retry to the single truthful forfeit',
        actual: (await attendance.evaluate(roundId))?.decision,
        expected: 'forfeit',
      });
    } finally {
      await cleanup();
    }
  }));

test('fresh scheduled-speaker erasure resolves none instead of inventing absence or vacuous abandonment', async () =>
  withAttendanceRound(async (input) => {
    const { f, attendance, roundId, segmentId } = input;
    const cleanup = await settleAttendanceFixture(input, false, false);
    try {
      await f.sql`update users set deleted_at=statement_timestamp(),username=null where id=${f.host.userId}`;
      const resolution = await attendance.evaluate(roundId);
      const round = await f.store.getRound(roundId);
      const [receipt] =
        await f.sql`select decision from round_attendance_adjudications where round_id=${roundId} and segment_id=${segmentId}`;
      assert({
        given:
          'all recorded attendance absent but scheduled speaker freshly ineligible',
        should:
          'resolve an explicit immutable no-decision while preserving active Round and actual check-in facts',
        actual: {
          decision: resolution?.decision,
          receipt: receipt?.decision,
          status: round?.status,
          outcome: round?.outcome,
          checkins: (
            await f.sql`select command_id from round_check_ins where round_id=${roundId}`
          ).length,
        },
        expected: {
          decision: 'none',
          receipt: 'none',
          status: 'active',
          outcome: null,
          checkins: 0,
        },
      });
    } finally {
      await cleanup();
    }
  }));
