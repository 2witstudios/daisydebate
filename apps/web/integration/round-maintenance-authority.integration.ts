import { buildDebateTopic } from '@daisy/protocol';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import {
  createRoundMaintenanceOperations,
  ROUND_START_HORIZON_MS,
} from '../src/features/round-finalization/maintenance';
import { withAttendanceRound } from './attendance.test-support';
import { settleAttendanceFixture } from './attendance-evaluator.test-support';
setupRitewayBun();
requireTestServices(process.env);

async function evaluationState(
  input: Parameters<Parameters<typeof withAttendanceRound>[0]>[0],
) {
  const { f, roundId } = input;
  const [row] = await f.sql`select jsonb_build_object(
    'round',(select to_jsonb(r) from rounds r where id=${roundId}),
    'segments',(select jsonb_agg(to_jsonb(s) order by sequence) from round_segments s where round_id=${roundId}),
    'speaking',(select jsonb_agg(to_jsonb(i) order by id) from round_speaking_intervals i where round_id=${roundId}),
    'commands',(select jsonb_agg(to_jsonb(c) order by command_id) from round_commands c where round_id=${roundId}),
    'adjudications',(select jsonb_agg(to_jsonb(a) order by segment_id) from round_attendance_adjudications a where round_id=${roundId}),
    'outbox',(select jsonb_agg(to_jsonb(o) order by seq) from outbox o where topic=${buildDebateTopic(roundId)})
  ) state`;
  return row.state;
}

test('a D5 service expiring between tick and evaluation cannot adjudicate', async () =>
  withAttendanceRound(async (input) => {
    const { f, roundId } = input,
      cleanup = await settleAttendanceFixture(input, true, false),
      instanceId = createId();
    try {
      const attendance = createAttendanceFeature({
        checkIns: f.store,
        evaluate: f.store.evaluateRoundAttendance,
        nextId: createId,
        instanceId,
      });
      const ops = createRoundMaintenanceOperations({
        startHorizonMs: ROUND_START_HORIZON_MS,
        probeRoundId: null,
        idleTimeoutMs: null,
        store: f.store,
        instanceId,
        ids: { next: createId },
        evaluate: attendance.evaluate,
      });
      await assertRejects({
        given: 'an unknown web instance invoking actual attendance evaluation',
        should: 'refuse missing authority',
        actual: () => ops.evaluate(roundId),
        code: 'AUTHORIZATION',
      });
      const [cursor] =
        await f.sql`select txid::text,seq::text from outbox order by seq desc limit 1`;
      await f.store.renewServiceInstance({
        instanceId,
        role: 'realtime',
        deliveredThrough: { txid: cursor.txid, seq: BigInt(cursor.seq) },
      });
      await assertRejects({
        given: 'a fresh realtime role invoking web maintenance evaluation',
        should: 'refuse the wrong canonical role',
        actual: () => ops.evaluate(roundId),
        code: 'AUTHORIZATION',
      });
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
      await f.store.renewServiceInstance({ instanceId, role: 'web' });
      await ops.tick(roundId);
      await f.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
      const before = await evaluationState(input);
      await assertRejects({
        given:
          'a real D5 tick followed by expiry of its actual web service lease',
        should: 'refuse the actual evaluator within its own transaction',
        actual: () => ops.evaluate(roundId),
        code: 'AUTHORIZATION',
      });
      const [facts] =
        await f.sql`select (select count(*)::int from round_attendance_adjudications where round_id=${roundId}) decisions,(select count(*)::int from round_commands where round_id=${roundId} and type='adjudicate') receipts`;
      assert({
        given:
          'a stale web evaluator with healthy historical evidence and a genuine forfeit candidate',
        should: 'preserve full active state with no adjudication or receipt',
        actual: { round: await evaluationState(input), facts },
        expected: { round: before, facts: { decisions: 0, receipts: 0 } },
      });
      await f.store.renewServiceInstance({ instanceId, role: 'web' });
      const results = await Promise.allSettled([
        ops.evaluate(roundId),
        ops.evaluate(roundId),
      ]);
      const [committed] =
        await f.sql`select status,(select count(*)::int from round_attendance_adjudications where round_id=${roundId}) decisions,(select count(*)::int from round_commands where round_id=${roundId} and type='adjudicate') receipts from rounds where id=${roundId}`;
      assert({
        given:
          'a renewed genuine web service and concurrent actual evaluator attempts',
        should: 'preserve the valid exactly-once shared-engine forfeit path',
        actual: {
          decisions: results
            .filter((r) => r.status === 'fulfilled')
            .map((r) => r.value?.decision),
          refusals: results.filter((r) => r.status === 'rejected').length,
          committed,
        },
        expected: {
          decisions: ['forfeit'],
          refusals: 1,
          committed: { status: 'completed', decisions: 1, receipts: 1 },
        },
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
      await cleanup();
    }
  }));

for (const waitAt of ['Round', 'receipt'] as const)
  test(`actual evaluator rechecks current service after waiting at ${waitAt}`, async () =>
    withAttendanceRound(async (input) => {
      const { f, roundId } = input,
        cleanup = await settleAttendanceFixture(input, true, false),
        instanceId = createId(),
        commandId = createId();
      const holder = await f.sql.reserve();
      let pending: Promise<unknown> | undefined;
      try {
        await f.store.renewServiceInstance({ instanceId, role: 'web' });
        await holder`begin`;
        const [backend] = await holder`select pg_backend_pid() as pid`;
        if (waitAt === 'Round')
          await holder`select id from rounds where id=${roundId} for no key update`;
        else
          await holder`insert into round_commands(command_id,round_id,service_id,type,payload_digest,result,resulting_version,applied_at) values(${commandId},${roundId},${`round-attendance:${instanceId}`},'adjudicate',${'b'.repeat(64)},${{}},1,clock_timestamp())`;
        await f.sql`update service_instances set renewed_at=clock_timestamp()-interval '2.8 seconds' where instance_id=${instanceId}`;
        const attendance = createAttendanceFeature({
          checkIns: f.store,
          evaluate: f.store.evaluateRoundAttendance,
          nextId: () => commandId,
          instanceId,
        });
        const ops = createRoundMaintenanceOperations({
          startHorizonMs: ROUND_START_HORIZON_MS,
          probeRoundId: null,
          idleTimeoutMs: null,
          store: f.store,
          instanceId,
          ids: { next: createId },
          evaluate: attendance.evaluate,
        });
        const before = await evaluationState(input);
        pending = ops.evaluate(roundId);
        const refusal = assertRejects({
          given: `fresh actual service waits at ${waitAt} until its lease expires`,
          should: 'refuse within the same evaluation transaction',
          actual: () => pending!,
          code: 'AUTHORIZATION',
        });
        const blocked = await finishedOrBlockedBehind(
          pending,
          f.sql,
          backend.pid,
          { now: performance.now, deadlineMs: 700 },
        );
        await f.sql`select pg_sleep(greatest(extract(epoch from (renewed_at+interval '3.03 seconds'-clock_timestamp())),0)) from service_instances where instance_id=${instanceId}`;
        await holder`rollback`;
        await refusal;
        const [facts] =
          await f.sql`select (select count(*)::int from round_attendance_adjudications where round_id=${roundId}) decisions,(select count(*)::int from round_commands where round_id=${roundId} and type='adjudicate') receipts`;
        assert({
          given: `actual ${waitAt} contention after initial authority`,
          should:
            'roll back all proposed competitive state and receipt after lease expiry',
          actual: { blocked, round: await evaluationState(input), facts },
          expected: {
            blocked: 'blocked',
            round: before,
            facts: { decisions: 0, receipts: 0 },
          },
        });
      } finally {
        await holder`rollback`;
        holder.release();
        if (pending) await Promise.allSettled([pending]);
        await f.sql`delete from service_instances where instance_id=${instanceId}`;
        await cleanup();
      }
    }));
