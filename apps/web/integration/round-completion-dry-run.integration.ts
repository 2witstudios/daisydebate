import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { buildRoundTopic } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import {
  predictRoundCompletion,
  readDryRunFacts,
} from '../scripts/round-completion-dry-run-report';
import { botAdmissionForTests } from './bot-admission.test-support';
import { frozenBotJudgeRound } from './round-judging.test-support';
import { finalizeByMaintenance } from './round-maintenance.test-support';
import { withRoomRuntime } from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

const judging = {
  ...botAdmissionForTests,
  judging: {
    leaseMs: 60000,
    model: 'fixture-model',
    nextToken: () => randomBytes(32).toString('base64url'),
  },
};
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** The incident's shape: every debater on time, a failed AI job, no adjudication. */
async function incidentRound(f: Fixture) {
  const { roundId } = await frozenBotJudgeRound(f, true);
  await f.sql`update round_judging_jobs set status='failed' where round_id=${roundId}`;
  const round = (await f.store.getRound(roundId))!;
  for (const segment of round.segments.filter((s) => s.type === 'speech')) {
    const rule = round.rules.segments.find(
      (s) => s.key === segment.rulesSegmentKey,
    )!;
    if (rule.type !== 'speech') continue;
    const seat = round.participants.find(
      (p) => p.role === rule.side && p.slot === rule.slot,
    )!;
    const commandId = createId();
    await f.sql`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,result,resulting_version,applied_at)
      values(${commandId},${roundId},${seat.actorId},'check_in',${'a'.repeat(64)},${{}},1,statement_timestamp())`;
    await f.sql`insert into round_check_ins(command_id,round_id,segment_id,participant_id,received_at)
      select ${commandId},${roundId},id,${seat.id},started_at+interval '1 second' from round_segments where id=${segment.id}
      on conflict do nothing`;
  }
  return roundId;
}

test('the dry run predicts what the real maintenance path then does, and cannot write', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await incidentRound(f);
    const before =
      await f.sql`select version,status from rounds where id=${roundId}`;
    const report = predictRoundCompletion(
      (await readDryRunFacts(f.sql, roundId))!,
    );
    const after =
      await f.sql`select version,status from rounds where id=${roundId}`;
    assert({
      given: 'a read of an incident-shaped Round',
      should: 'change nothing and predict completion with zero paid calls',
      actual: { unchanged: after, prediction: report.prediction },
      expected: {
        unchanged: before,
        prediction: {
          mostNewPaidCalls: 0,
          result: 'completed',
          ruling: 'judging-failed',
          outcome: null,
          ratingWritten: false,
        },
      },
    });
    assert({
      given: 'the report',
      should: 'carry no name, topic or transcript',
      actual: /Cities|label|transcript_text|resolution/i.test(
        JSON.stringify(report),
      ),
      expected: false,
    });
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const attendance = createAttendanceFeature({
      checkIns: f.store,
      evaluate: f.store.evaluateRoundAttendance,
      nextId: createId,
      instanceId,
    });
    for (let pass = 0; pass < 8; pass++)
      if ((await attendance.evaluate(roundId)) === null) break;
    await finalizeByMaintenance(f, roundId);
    const done = (await f.store.getRound(roundId))!;
    const view = await f.store.readLaunchedRound(roundId, f.host, () => true);
    assert({
      given: 'the real attendance and completion path afterwards',
      should: 'do exactly what the dry run said',
      actual: {
        status: done.status,
        outcome: done.outcome,
        ruling: view.panelRuling,
      },
      expected: {
        status: 'completed',
        outcome: null,
        ruling: 'judging-failed',
      },
    });
    await f.sql`delete from outbox where topic=${buildRoundTopic(roundId)}`;
    await f.sql`delete from service_instances where instance_id=${instanceId}`;
  }, judging);
});
