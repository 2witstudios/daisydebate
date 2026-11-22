import { buildRoundTopic } from '@daisy/protocol/topics';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import {
  panelAdmission,
  requirePanelRound,
} from '../src/features/round-finalization/admission';
import { attendanceEvaluationAdmission } from '../src/features/attendance/evaluation-admission';
import {
  botGrantUnused,
  captureRule,
  judgingJobEndReason,
  attendanceSettled,
} from '@daisy/debate-engine';
import { judgingPolicy } from '@daisy/protocol/judging-policy';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { setupRitewayBun, test, assert } from 'riteway/bun';
import {
  judgingPlan,
  panelCompletion,
} from '../src/features/round-finalization/maintenance';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
import { withAttendanceRound } from './attendance.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('real panel caller requires application fully-played admission', () =>
  withRoomRuntime(async (f) => {
    const { roundId } = await launchRuntimeRound(f, await f.assemble());
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const request = {
      ...panelAdmission,
      roundId,
      instanceId,
      commandId: createId(),
      freezeRevision: 1,
      buildProjection: roundTickProjection(createId),
      buildCompletion: panelCompletion(createId),
      judgingEndReason: judgingJobEndReason,
      attendanceSettled,
      botGrantUnused,
      captureRule,
      planJudging: judgingPlan(judgingPolicy.humanBallotWindowMs),
    };
    try {
      await f.sql`update rounds set started_at=clock_timestamp()-interval '20 minutes' where id=${roundId}`;
      await f.store.finalizeDueRoundTranscript(request);
      await seedSettledAttendanceLedger(f, roundId);
      await assertRejects({
        given: 'the application refuses a real frozen and settled panel',
        should: 'honor its acceptance owner rather than silently complete',
        actual: () =>
          f.store.completePanelRound({
            ...request,
            ...{
              requirePlayedRound: () => {
                throw createAppError('AUTHORIZATION');
              },
            },
          }),
        code: 'AUTHORIZATION',
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));

test('real attendance evaluator requires application active-Round acceptance', () =>
  withAttendanceRound(async ({ f, roundId }) => {
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    try {
      await assertRejects({
        given: 'the application refuses a live attendance pass',
        should: 'honor acceptance before reading competitive evidence',
        actual: () =>
          f.store.evaluateRoundAttendance({
            admitEvaluation: attendanceEvaluationAdmission,
            roundId,
            instanceId,
            commandId: createId(),
            nextWindow: () => undefined,
            judgingEndReason: judgingJobEndReason,
            resolveOnReceipts: () => null,
            resolve: () => null,
            ...{
              requireRound: () => {
                throw createAppError('AUTHORIZATION');
              },
            },
          }),
        code: 'AUTHORIZATION',
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));

// Native JSON text retains timestamps and all durable fields, ordered by unique keys.
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
const snapshot = async (f: Fixture, roundId: string) => {
  const [row] = await f.sql`select
    (select row_to_json(r)::text from rounds r where id=${roundId}) as round,
    (select jsonb_agg(to_jsonb(s) order by s.id)::text from round_segments s where round_id=${roundId}) as segments,
    (select jsonb_agg(to_jsonb(c) order by c.command_id)::text from round_commands c where round_id=${roundId}) as receipts,
    (select jsonb_agg(to_jsonb(a) order by a.segment_id)::text from round_attendance_adjudications a where round_id=${roundId}) as attendance,
    (select jsonb_agg(to_jsonb(n) order by n.id)::text from notifications n where round_id=${roundId}) as notifications,
    (select jsonb_agg(to_jsonb(n) order by n.kind,n.round_id)::text from notification_fanouts n where round_id=${roundId}) as obligations,
    (select jsonb_agg(to_jsonb(o) order by o.txid,o.seq)::text from outbox o where topic=${buildRoundTopic(roundId)}) as outbox`;
  return { ...row };
};
const requestFor = (roundId: string, instanceId: string) => ({
  ...panelAdmission,
  roundId,
  instanceId,
  commandId: createId(),
  freezeRevision: 1,
  buildProjection: roundTickProjection(createId),
  buildCompletion: panelCompletion(createId),
  judgingEndReason: judgingJobEndReason,
  attendanceSettled,
  botGrantUnused,
  captureRule,
  planJudging: judgingPlan(judgingPolicy.humanBallotWindowMs),
});

test('panel app refusal after a real clock advance rolls back tick, receipt and notification obligations', () =>
  withRoomRuntime(async (f) => {
    const { roundId } = await launchRuntimeRound(f, await f.assemble());
    const instanceId = createId();
    const request = requestFor(roundId, instanceId);
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    await f.sql`update rounds set started_at=clock_timestamp()-interval '20 minutes' where id=${roundId}`;
    const before = await snapshot(f, roundId);
    let sawPlayed = false;
    try {
      await assertRejects({
        given:
          'the application refuses after the transaction ticks the actual Round',
        should:
          'propagate refusal before frozen facts and roll back every effect',
        actual: () =>
          f.store.completePanelRound({
            ...request,
            requirePlayedRound: (round) => {
              requirePanelRound(round);
              sawPlayed = true;
              throw createAppError('AUTHORIZATION');
            },
          }),
        code: 'AUTHORIZATION',
      });
      assert({
        given: 'the app observed the fully played post-tick Round',
        should:
          'retain exact original native Round/segments/receipts/attendance/notification obligations',
        actual: { sawPlayed, state: await snapshot(f, roundId) },
        expected: { sawPlayed: true, state: before },
      });
      await assertRejects({
        given: 'the same tick followed by an unexpected application exception',
        should: 'normalize the exception and roll back the transaction',
        actual: () =>
          f.store.completePanelRound({
            ...request,
            requirePlayedRound: () => {
              throw Error('controlled acceptance exception');
            },
          }),
        code: 'INFRASTRUCTURE',
      });
      assert({
        given: 'the unexpected app exception',
        should: 'leave the same original durable state',
        actual: await snapshot(f, roundId),
        expected: before,
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));

test('terminal panel replay keeps its original receipt and only asks active admission for a new alias', () =>
  withRoomRuntime(async (f) => {
    const { roundId } = await launchRuntimeRound(f, await f.assemble());
    const instanceId = createId();
    const request = requestFor(roundId, instanceId);
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    try {
      await f.sql`update rounds set started_at=clock_timestamp()-interval '20 minutes' where id=${roundId}`;
      await f.store.finalizeDueRoundTranscript(request);
      await seedSettledAttendanceLedger(f, roundId);
      const original = await f.store.completePanelRound(request);
      const before = await snapshot(f, roundId);
      let active = 0,
        played = 0;
      const same = await f.store.completePanelRound({
        ...request,
        requireActiveRound: () => {
          active++;
          throw createAppError('AUTHORIZATION');
        },
        requirePlayedRound: () => {
          played++;
          throw createAppError('AUTHORIZATION');
        },
      });
      const alias = await f.store.completePanelRound({
        ...request,
        commandId: createId(),
        requireActiveRound: (round) => {
          active++;
          panelAdmission.requireActiveRound(round);
        },
        requirePlayedRound: () => {
          played++;
          throw createAppError('AUTHORIZATION');
        },
      });
      assert({
        given:
          'the original completion replay and another command alias after terminal completion',
        should:
          'keep original native receipt/outcome, skip played admission and preserve exact durable rows',
        actual: {
          active,
          played,
          same,
          alias,
          state: await snapshot(f, roundId),
        },
        expected: {
          active: 1,
          played: 0,
          same: { ...original, replayed: true },
          alias: { ...original, replayed: true },
          state: before,
        },
      });
      const terminalAttendance = createAttendanceFeature({
        checkIns: f.store,
        nextId: createId,
        instanceId,
        evaluate: (input) =>
          f.store.evaluateRoundAttendance({
            ...input,
            admitEvaluation: () => {
              throw Error('A terminal Round reached incident selection');
            },
          }),
      });
      await assertRejects({
        given:
          'the actual Attendance application after the panel really completed the Round',
        should:
          'refuse as attendance-terminal before incident or evidence admission',
        actual: () => terminalAttendance.evaluate(roundId),
        code: 'CONFLICT',
        reason: 'attendance-terminal',
      });
      assert({
        given: 'that terminal Attendance evaluation refusal',
        should: 'preserve all native rows including receipts and outbox',
        actual: await snapshot(f, roundId),
        expected: before,
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));

test('actual Attendance feature supplies acceptance before evidence, and incident choice precedes pending writers', () =>
  withAttendanceRound(async ({ f, roundId }) => {
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    try {
      const calls: string[] = [];
      const feature = createAttendanceFeature({
        checkIns: f.store,
        nextId: createId,
        instanceId,
        evaluate: (request) =>
          f.store.evaluateRoundAttendance({
            ...request,
            requireRound: (round) => {
              request.requireRound(round);
              calls.push('active');
            },
            admitEvaluation: (round) => {
              calls.push('incident');
              return request.admitEvaluation(round);
            },
          }),
      });
      const before = await snapshot(f, roundId);
      await feature.evaluate(roundId);
      assert({
        given:
          'the real application evaluator with no settled availability window',
        should:
          'invoke its app-owned active and incident acceptance in order without competitive changes',
        actual: { calls, state: await snapshot(f, roundId) },
        expected: { calls: ['active', 'incident'], state: before },
      });
      const attemptId = createId();
      await f.sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,received_at,backend_pid,backend_started_at) select ${attemptId},${createId()},${roundId},${'d'.repeat(64)},${f.host.actorId},statement_timestamp(),pid,backend_start from pg_stat_activity where pid=pg_backend_pid()`;
      const heldFeature = createAttendanceFeature({
        checkIns: f.store,
        nextId: createId,
        instanceId,
        evaluate: (request) =>
          f.store.evaluateRoundAttendance({
            ...request,
            admitEvaluation: () => ({
              kind: 'held',
              reason: 'platform_incident',
            }),
            resolveOnReceipts: () => {
              throw Error('Held evaluator reached receipts');
            },
            resolve: () => {
              throw Error('Held evaluator reached evidence');
            },
          }),
      });
      const held = await heldFeature.evaluate(roundId);
      const pending = await feature.evaluate(roundId);
      assert({
        given:
          'an application platform hold and a durable pending writer, then an ordinary admitted pass',
        should:
          'prioritize app incident hold and retain the separate storage uncertainty hold without a decision',
        actual: { held, pending, state: await snapshot(f, roundId) },
        expected: {
          held: { kind: 'held', reason: 'platform_incident' },
          pending: { kind: 'held', reason: 'pending_writer' },
          state: before,
        },
      });
      await f.sql`update round_check_in_attempts set state='aborted',resolved_at=clock_timestamp() where attempt_id=${attemptId}`;
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));
