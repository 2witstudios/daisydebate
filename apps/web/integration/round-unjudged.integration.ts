import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createRoundMaintenanceOperations,
  DEFAULT_BALLOT_DEADLINE_MS,
  unjudgedCompletion,
} from '../src/features/round-finalization/maintenance';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('internal zerojudge completion requires real freeze and settled attendance then survives concurrent restart retries', async () =>
  withRoomRuntime(async (f) => {
    const { roundId } = await startRuntimeRound(f, await f.assemble());
    const instanceId = createId(),
      restartedInstanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const request = {
      roundId,
      instanceId,
      commandId: createId(),
      freezeRevision: 1,
      buildProjection: roundTickProjection(createId),
      buildCompletion: unjudgedCompletion(createId),
      ballotDeadlineMs: DEFAULT_BALLOT_DEADLINE_MS,
    };
    try {
      await assertRejects({
        given: 'an unfinished actual zerojudge Room',
        should: 'refuse without terminal writes',
        actual: () => f.store.completeUnjudgedRound(request),
        code: 'CONFLICT',
      });
      // Component boundary: rebase before the engine creates actual segment/end/cutoff rows.
      await f.sql`update rounds set started_at=clock_timestamp()-interval '20 minutes' where id=${roundId}`;
      await f.store.finalizeDueRoundTranscript(request);
      await assertRejects({
        given: 'an immutable freeze with unresolved historical attendance',
        should: 'refuse completion',
        actual: () => f.store.completeUnjudgedRound(request),
        code: 'CONFLICT',
      });
      // This fixture proves consumption of the durable settlement ledger, not RT evaluator acceptance.
      await seedSettledAttendanceLedger(f, roundId);
      const before = await f.store.getRound(roundId);
      await assertRejects({
        given: 'a caller naming another immutable freeze revision',
        should: 'refuse without completion',
        actual: () =>
          f.store.completeUnjudgedRound({ ...request, freezeRevision: 2 }),
        code: 'CONFLICT',
      });
      const attemptId = createId();
      await f.sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,received_at,backend_pid,backend_started_at) select ${attemptId},${createId()},${roundId},${'b'.repeat(64)},${f.host.actorId},statement_timestamp(),pid,backend_start from pg_stat_activity where pid=pg_backend_pid()`;
      await assertRejects({
        given: 'a settled ledger with a durable pending receipt',
        should: 'refuse terminal completion',
        actual: () => f.store.completeUnjudgedRound(request),
        code: 'CONFLICT',
      });
      assert({
        given: 'revision and pending-marker refusals',
        should: 'preserve full projected state and no receipt',
        actual: {
          round: await f.store.getRound(roundId),
          receipts: (
            await f.sql`select command_id from round_commands where round_id=${roundId} and type='complete'`
          ).length,
        },
        expected: { round: before, receipts: 0 },
      });
      await f.sql`update round_check_in_attempts set state='aborted',resolved_at=clock_timestamp() where attempt_id=${attemptId}`;

      const receipts = await Promise.all([
        f.store.completeUnjudgedRound(request),
        f.store.completeUnjudgedRound({ ...request, commandId: createId() }),
      ]);
      await f.store.renewServiceInstance({
        instanceId: restartedInstanceId,
        role: 'web',
      });
      const restarted = await f.store.completeUnjudgedRound({
        ...request,
        instanceId: restartedInstanceId,
        commandId: createId(),
      });
      const maintenance = await createRoundMaintenanceOperations({
        store: f.store,
        instanceId,
        ids: { next: createId },
        evaluate: async () => null,
      }).finalize(roundId);
      const [facts] =
        await f.sql`select status,outcome,(select count(*)::int from round_commands where round_id=${roundId} and type='complete') receipts,(select count(*)::int from ballots where round_id=${roundId}) ballots,(select count(*)::int from rating_changes where round_id=${roundId}) ratings from rounds where id=${roundId}`;
      assert({
        given:
          'concurrent internal maintenance and restart after actual freeze/settlement',
        should:
          'preserve one completed NULL result and exact receipt with no ballot or rating',
        actual: {
          facts,
          commands: [...receipts, restarted].map((x) => x.commandId),
          replayed: restarted.replayed,
          maintenance: maintenance.status,
        },
        expected: {
          facts: {
            status: 'completed',
            outcome: null,
            receipts: 1,
            ballots: 0,
            ratings: 0,
          },
          commands: Array(3).fill(receipts[0]!.commandId),
          replayed: true,
          maintenance: 'frozen',
        },
      });
    } finally {
      await f.sql`delete from service_instances where instance_id in (${instanceId},${restartedInstanceId})`;
    }
  }));

test('internal zerojudge completion preserves a prior competitive abandonment and refuses another command collision', async () =>
  withRoomRuntime(async (f) => {
    const { roundId, envelope } = await startRuntimeRound(
      f,
      await f.assemble(),
    );
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const request = {
      roundId,
      instanceId,
      commandId: envelope.commandId,
      freezeRevision: 1,
      buildProjection: roundTickProjection(createId),
      buildCompletion: unjudgedCompletion(createId),
      ballotDeadlineMs: DEFAULT_BALLOT_DEADLINE_MS,
    };
    try {
      const active = await f.store.getRound(roundId);
      await assertRejects({
        given: 'an internal completion reusing the accepted start command ID',
        should: 'refuse global-command collision',
        actual: () => f.store.completeUnjudgedRound(request),
        code: 'CONFLICT',
      });
      assert({
        given: 'a global-command collision',
        should: 'preserve the actual active Round',
        actual: await f.store.getRound(roundId),
        expected: active,
      });
      await f.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp(),version=version+1 where id=${roundId}`;
      const abandoned = await f.store.getRound(roundId);
      await assertRejects({
        given: 'a prior durable abandoned Round',
        should: 'preserve its terminal decision',
        actual: () =>
          f.store.completeUnjudgedRound({ ...request, commandId: createId() }),
        code: 'CONFLICT',
      });
      assert({
        given: 'a refused attempt to replace abandonment',
        should: 'retain complete terminal state',
        actual: await f.store.getRound(roundId),
        expected: abandoned,
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));
