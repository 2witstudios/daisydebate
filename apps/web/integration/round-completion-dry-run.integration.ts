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
import {
  fixtureBallot,
  freezeBotJudge,
  frozenBotJudgeRound,
} from './round-judging.test-support';
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

/** Every debater on time, none of it adjudicated yet. */
async function creditEverySpeaker(f: Fixture, roundId: string) {
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
}

/** The incident's shape: every debater on time, a failed AI job, no adjudication. */
async function incidentRound(f: Fixture, captured = true) {
  const { roundId } = await frozenBotJudgeRound(f, captured);
  await f.sql`update round_judging_jobs set status='failed' where round_id=${roundId}`;
  await creditEverySpeaker(f, roundId);
  return roundId;
}

const passCutoff = (f: Fixture, roundId: string) =>
  f.sql`update rounds set attendance_resolution_cutoff_at=clock_timestamp()-interval '1 hour' where id=${roundId}`;

const predict = async (f: Fixture, roundId: string) =>
  predictRoundCompletion((await readDryRunFacts(f.sql, roundId))!);

/** The production attendance passes, then the production completion. */
async function realPath(f: Fixture, roundId: string) {
  const instanceId = createId();
  await f.store.renewServiceInstance({ instanceId, role: 'web' });
  const attendance = createAttendanceFeature({
    checkIns: f.store,
    evaluate: f.store.evaluateRoundAttendance,
    nextId: createId,
    instanceId,
  });
  for (let pass = 0; pass < 8; pass++) {
    const decided = await attendance.evaluate(roundId);
    if (!decided || decided.decision === 'abandoned') break;
  }
  if ((await f.store.getRound(roundId))!.status === 'active')
    await finalizeByMaintenance(f, roundId);
  const done = (await f.store.getRound(roundId))!;
  const view = await f.store.readLaunchedRound(roundId, f.host, () => true);
  await f.sql`delete from service_instances where instance_id=${instanceId}`;
  return {
    status: done.status,
    outcome: done.outcome,
    ruling: view.panelRuling,
  };
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

test('an incomplete freeze with a failed AI job: prediction and real path agree', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await incidentRound(f, false);
    const { prediction } = await predict(f, roundId);
    assert({
      given: "the second incident Round's shape",
      should: 'predict completion with no winner, no rating and no paid call',
      actual: prediction,
      expected: {
        mostNewPaidCalls: 0,
        result: 'completed',
        ruling: 'transcript-incomplete',
        outcome: null,
        ratingWritten: false,
      },
    });
    assert({
      given: 'the real path afterwards',
      should: 'do what the dry run said',
      actual: await realPath(f, roundId),
      expected: {
        status: 'completed',
        outcome: null,
        ruling: 'transcript-incomplete',
      },
    });
  }, judging);
});

test('an unproven window with no history: the stated fallback is what the real path does', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId } = await frozenBotJudgeRound(f, true);
    await f.sql`update round_judging_jobs set status='failed' where round_id=${roundId}`;
    await passCutoff(f, roundId);
    const { prediction } = await predict(f, roundId);
    assert({
      given: 'no receipts, no samples, past the cutoff',
      should: 'say it depends on history and state the fallback',
      actual: {
        result: prediction.result,
        calls: prediction.mostNewPaidCalls,
        fallback: (prediction.ifHistoryCannotDecide as { result: string })
          .result,
      },
      expected: {
        result: 'depends_on_availability_history',
        calls: 0,
        fallback: 'abandoned_no_winner',
      },
    });
    assert({
      given: 'the real path afterwards',
      should: 'end the Round abandoned with no winner',
      actual: await realPath(f, roundId),
      expected: { status: 'abandoned', outcome: null, ruling: null },
    });
  }, judging);
});

test('a held ballot: settling windows open its bound, and past the bound it stops holding', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, target } = await freezeBotJudge(f);
    await creditEverySpeaker(f, roundId);
    const claim = await f.store.claimRoundJudgingJob(target);
    await f.store.beginRoundJudgingModelCall(claim.scope, claim.token);
    await f.store.saveRoundJudgingResult(
      claim.scope,
      claim.token,
      fixtureBallot('A validated answer held by the worker.', 'negative'),
      { inputTokens: 1, outputTokens: 1 },
    );
    await f.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 hour' where round_id=${roundId}`;
    await passCutoff(f, roundId);
    assert({
      given: 'a held ballot past its cutoff, with on-time windows undecided',
      should:
        'predict a wait, because deciding them gives the ballot its grace',
      actual: (await predict(f, roundId)).prediction,
      expected: { mostNewPaidCalls: 0, result: 'waiting_on_a_judge' },
    });
    assert({
      given: 'the real path afterwards',
      should: 'leave the Round waiting on that ballot',
      actual: await realPath(f, roundId),
      expected: { status: 'active', outcome: null, ruling: null },
    });
    await f.sql`update round_commands set applied_at=clock_timestamp()-interval '1 hour' where round_id=${roundId} and type='adjudicate'`;
    assert({
      given: 'the same ballot past the grace',
      should: 'predict completion with no winner',
      actual: (await predict(f, roundId)).prediction,
      expected: {
        mostNewPaidCalls: 0,
        result: 'completed',
        ruling: 'judging-failed',
        outcome: null,
        ratingWritten: false,
      },
    });
    assert({
      given: 'the real path afterwards',
      should: 'do what the dry run said',
      actual: await realPath(f, roundId),
      expected: {
        status: 'completed',
        outcome: null,
        ruling: 'judging-failed',
      },
    });
  }, judging);
});

test('a job inside its budget can still buy calls while attendance or a writer holds the Round', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId } = await freezeBotJudge(f);
    const facts = (await readDryRunFacts(f.sql, roundId))!;
    assert({
      given: 'an unserved job inside its budget',
      should: 'count its calls on both holding branches',
      actual: [
        predictRoundCompletion(facts).prediction,
        predictRoundCompletion({ ...facts, pendingWriters: 1 }).prediction,
      ].map(({ result, mostNewPaidCalls }) => [
        result ?? null,
        mostNewPaidCalls,
      ]),
      expected: [
        ['depends_on_availability_history', 2],
        ['unchanged', 2],
      ],
    });
  }, judging);
});
