import { passAttendanceCutoff } from './round-attendance-fixture.test-support';
import { judgingJobRules } from '@daisy/debate-engine';
import { withSeasons } from '@daisy/db/seasons';
import { recoverRatedResults } from './rated-room.test-support';
import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { buildRoundTopic, type Ballot } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import {
  createRoundMaintenanceOperations,
  ROUND_START_HORIZON_MS,
} from '../src/features/round-finalization/maintenance';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import {
  fixtureBallot,
  freezeBotJudge,
  playOut,
  readyTwoHumanJudgeRoom,
} from './round-judging.test-support';
import {
  finalizeAsWeb,
  passBallotDeadline,
} from './round-maintenance.test-support';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
const ruling = (winner: Ballot['winner']) =>
  fixtureBallot('The decisive clash was answered by this side.', winner);

/** A frozen casual Round with two seated human judges and settled attendance. */
async function frozenTwoJudgeRound(f: Fixture) {
  const { room, judges } = await readyTwoHumanJudgeRoom(f);
  const { roundId } = await startRuntimeRound(f, room);
  const initial = (await f.store.getRound(roundId))!;
  const elapsedMs = initial.rules.segments.reduce(
    (total, segment) => total + segment.durationMs + initial.rules.countdownMs,
    125_000,
  );
  await f.sql`update rounds set started_at=clock_timestamp()-${elapsedMs}*interval '1 millisecond' where id=${roundId}`;
  if ((await finalizeAsWeb(f, roundId)).status !== 'frozen')
    throw Error('Expected actual finalizer freeze');
  await seedSettledAttendanceLedger(f, roundId);
  const seats = judges.map((judge) =>
    initial.participants.find((p) => p.actorId === judge.actorId)!,
  );
  return { roundId, judges, seats };
}

/** Production maintenance under fresh web leases. */
async function maintainWith<T>(
  f: Fixture,
  count: number,
  work: (finalize: (roundId: string) => Promise<unknown>[]) => Promise<T>,
) {
  const instances = Array.from({ length: count }, () => createId());
  for (const instanceId of instances)
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
  const operations = instances.map((instanceId) =>
    createRoundMaintenanceOperations({
      ratingFailed: (_id, error) => {
        throw error;
      },
      startHorizonMs: ROUND_START_HORIZON_MS,
      probeRoundId: null,
      store: f.store,
      instanceId,
      ids: { next: createId },
      evaluate: async () => null,
    }),
  );
  try {
    return await work((roundId) =>
      operations.map((operation) => operation.finalize(roundId)),
    );
  } finally {
    for (const instanceId of instances)
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
  }
}
const completions = (f: Fixture, roundId: string) =>
  f.sql`select result from round_commands where round_id=${roundId} and type='complete'`;

const submitAs = (
  f: Fixture,
  judge: { readonly actorId: string },
  roundId: string,
  judgeParticipantId: string,
  winner: Ballot['winner'],
) =>
  f.store.getRound(roundId).then((round) =>
    createRoundBallotOperations({
      store: f.store,
      nextBallotId: createId,
      nextSegmentId: createId,
    }).submit({ kind: 'human', actorId: judge.actorId }, roundId, {
      version: 1,
      commandId: createId(),
      expectedVersion: round!.version,
      judgeParticipantId,
      freezeRevision: 1,
      ballot: ruling(winner),
    }),
  );
/** A direct write completing the Round without a winner, refused or accepted at commit. */
const completeDirectly = (
  f: Fixture,
  roundId: string,
  completedAt: 'now' | 'deadline' = 'now',
) =>
  f.sql
    .begin((tx) =>
      completedAt === 'now'
        ? tx`update rounds set status='completed',current_stage=null,outcome=null,completed_at=clock_timestamp() where id=${roundId}`
        : tx`update rounds set status='completed',current_stage=null,outcome=null,completed_at=ballot_deadline_at where id=${roundId}`,
    )
    .then(
      () => 'accepted',
      (error: { constraint?: string }) => error.constraint ?? 'error',
    );

test('a judge who never rules is recorded as no ruling at the persisted deadline and the submitted ballot decides once (DEC-201, DEC-207)', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, judges, seats } = await frozenTwoJudgeRound(f);
    const [persisted] =
      await f.sql`select r.ballot_deadline_at = z.frozen_at + interval '30 minutes' as exact from rounds r join round_transcript_freezes z on z.round_id=r.id where r.id=${roundId}`;
    const early = [
      await completeDirectly(f, roundId),
      await completeDirectly(f, roundId, 'deadline'),
    ];
    await submitAs(f, judges[0]!, roundId, seats[0]!.id, 'negative');
    await maintainWith(f, 1, (finalize) => Promise.all(finalize(roundId)));
    const waiting = (await f.store.getRound(roundId))!;
    await passBallotDeadline(f.sql, roundId);
    const late = await submitAs(
      f,
      judges[1]!,
      roundId,
      seats[1]!.id,
      'affirmative',
    ).then(
      () => 'accepted',
      (error: { code?: string; message?: string }) =>
        `${error.code} ${error.message}`,
    );
    await maintainWith(f, 2, (finalize) => Promise.all(finalize(roundId)));
    const done = (await f.store.getRound(roundId))!;
    const receipts = await completions(f, roundId);
    assert({
      given:
        'a freeze under the 30-minute policy, a direct completion write and maintenance before the deadline, one ballot, then a late ballot and two instances after it',
      should:
        'persist the deadline, refuse the early write and the late ballot, then complete exactly once from the submitted ballot',
      actual: {
        persisted: persisted.exact,
        early,
        waiting: [waiting.status, waiting.outcome],
        late,
        ballots: (
          await f.sql`select count(*)::int n from ballots where round_id=${roundId}`
        )[0].n,
        done: [done.status, done.outcome],
        receipts: receipts.length,
        ruling: receipts[0]?.result.ruling,
        noRuling: receipts[0]?.result.noRuling,
        ratings: (
          await f.sql`select count(*)::int n from rating_changes where round_id=${roundId}`
        )[0].n,
      },
      expected: {
        persisted: true,
        early: [
          'rounds_winnerless_completion_check',
          'rounds_winnerless_completion_check',
        ],
        waiting: ['active', null],
        late: 'CONFLICT round-decided',
        ballots: 1,
        done: ['completed', 'negative'],
        receipts: 1,
        ruling: 'partial',
        noRuling: [seats[1]!.id],
        ratings: 0,
      },
    });
  });
});

test('when no judge rules by the deadline the Round completes without a winner', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, seats } = await frozenTwoJudgeRound(f);
    await passBallotDeadline(f.sql, roundId);
    await maintainWith(f, 1, (finalize) => Promise.all(finalize(roundId)));
    const done = (await f.store.getRound(roundId))!;
    const [receipt] = await completions(f, roundId);
    assert({
      given: 'two silent judges past the ballot deadline',
      should:
        "complete with a null outcome and a 'judges did not rule' receipt, never a draw",
      actual: [
        done.status,
        done.outcome,
        receipt?.result.ruling,
        receipt?.result.noRuling,
      ],
      expected: [
        'completed',
        null,
        'judges-did-not-rule',
        seats.map((seat) => seat.id),
      ],
    });
  });
});

test('an AI judging job no provider ever served by its budget is a known failure and spends no allowance (DEC-186)', async () => {
  await withRoomRuntime(
    async (f) => {
      const { roundId } = await freezeBotJudge(f);
      await seedSettledAttendanceLedger(f, roundId);
      // An AI seat is bounded by its own budget (DEC-275), not the human window.
      await f.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      await maintainWith(f, 1, (finalize) => Promise.all(finalize(roundId)));
      const [job] =
        await f.sql`select status,lease_token_digest from round_judging_jobs where round_id=${roundId}`;
      const [{ reservations }] =
        await f.sql`select count(*)::int as reservations from usage_reservations where round_id=${roundId}`;
      const round = (await f.store.getRound(roundId))!;
      assert({
        given:
          'an AI-judge-only Round frozen with no bot admission resource, its job never claimed (judging capacity exhausted) when the ballot deadline passes',
        should:
          'complete without a winner, fail the job without a lease and leave the host allowance untouched',
        actual: [round.status, round.outcome, job, reservations],
        expected: [
          'completed',
          null,
          { status: 'failed', lease_token_digest: null },
          0,
        ],
      });
    },
    {
      judging: {
        leaseMs: 60000,
        model: 'fixture-model',
        nextToken: () => randomBytes(32).toString('base64url'),
        contractVersion: 'fixture-contract',
        rules: judgingJobRules,
      },
    },
  );
});

for (const [captured, postings] of [
  [true, 2],
  [false, 0],
] as const)
  test(`on a rated Round with a ${captured ? 'complete' : 'incomplete'} freeze, a decisive ballot beside a silent judge posts ${postings} ratings (DEC-277)`, async () => {
    await withRoomRuntime(async (f) => {
      const seasonId = createId();
      const { room, judges } = await readyTwoHumanJudgeRoom(f);
      const { roundId } = await startRuntimeRound(f, room);
      const started = (await f.store.getRound(roundId))!;
      const seat = started.participants.find(
        (p) => p.actorId === judges[0]!.actorId,
      )!;
      await f.sql`update rounds set competition_type='ranked',format_id='freestyle',format_version=1,preset_version=1,ladder_id='freestyle' where id=${roundId}`;
      await playOut(f, roundId, captured);
      if ((await finalizeAsWeb(f, roundId)).status !== 'frozen')
        throw Error('Expected actual finalizer freeze');
      await seedSettledAttendanceLedger(f, roundId);
      try {
        await withSeasons(databaseUrl, (s) =>
          s.activateBetaSeason({ id: seasonId }),
        );
        await submitAs(f, judges[0]!, roundId, seat.id, 'negative');
        await passBallotDeadline(f.sql, roundId);
        await maintainWith(f, 1, (finalize) => Promise.all(finalize(roundId)));
        const done = (await f.store.getRound(roundId))!;
        const [receipt] = await completions(f, roundId);
        const awaited = await f.store.readRoundAwaitsRating(roundId);
        await recoverRatedResults(f);
        await recoverRatedResults(f);
        const ledger =
          await f.sql`select actor_id from rating_changes where round_id=${roundId}`;
        assert({
          given: 'one human ruling decisively and one silent past the deadline',
          should:
            'complete with that winner, posting each debater once only on a complete transcript',
          actual: {
            done: [done.status, done.outcome],
            ruling: receipt?.result.ruling,
            awaited,
            postings: ledger.length,
            awaitsAfter: await f.store.readRoundAwaitsRating(roundId),
          },
          expected: {
            done: ['completed', 'negative'],
            ruling: 'partial',
            awaited: captured,
            postings,
            awaitsAfter: false,
          },
        });
      } finally {
        await f.sql`delete from rating_changes where round_id=${roundId}`;
        await f.sql`delete from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
        await f.sql`delete from outbox where topic=${buildRoundTopic(roundId)}`;
        await f.sql`delete from rounds where id=${roundId}`;
        await f.sql`delete from seasons where id=${seasonId}`;
      }
    });
  });

test('an AI job out of budget with no worker running is reported once, with the real reason', async () => {
  await withRoomRuntime(
    async (f) => {
      const { roundId } = await freezeBotJudge(f);
      await seedSettledAttendanceLedger(f, roundId);
      await f.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      const reported: string[] = [];
      const instanceId = createId();
      await f.store.renewServiceInstance({ instanceId, role: 'web' });
      const maintenance = createRoundMaintenanceOperations({
        store: f.store,
        instanceId,
        ids: { next: createId },
        ratingFailed: () => {},
        evaluate: async () => null,
        startHorizonMs: 60_000,
        probeRoundId: null,
        judgingEnded: (reason) => reported.push(reason),
      });
      await maintenance.finalize(roundId);
      await maintenance.finalize(roundId);
      const [job] =
        await f.sql`select status,terminal_reason from round_judging_jobs where round_id=${roundId}`;
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
      assert({
        given: 'no judging worker ever claiming the job',
        should: 'record the budget as the reason and report it exactly once',
        actual: {
          job,
          reported,
          status: (await f.store.getRound(roundId))!.status,
        },
        expected: {
          job: { status: 'failed', terminal_reason: 'generation_deadline' },
          reported: ['generation_deadline'],
          status: 'completed',
        },
      });
    },
    {
      judging: {
        leaseMs: 60000,
        model: 'fixture-model',
        nextToken: () => randomBytes(32).toString('base64url'),
        contractVersion: 'fixture-contract',
        rules: judgingJobRules,
      },
    },
  );
});

const judgingOptions = {
  judging: {
    leaseMs: 60000,
    model: 'fixture-model',
    nextToken: () => randomBytes(32).toString('base64url'),
    contractVersion: 'fixture-contract',
    rules: judgingJobRules,
  },
};
/** A frozen AI-judged Round past its budget and cutoff, its worker holding a ballot or not. */
async function jobPastBudget(f: Fixture, holds: boolean) {
  const { roundId, target } = await freezeBotJudge(f);
  if (holds) {
    const claim = await f.store.claimRoundJudgingJob(target);
    await f.store.beginRoundJudgingModelCall(claim.scope, claim.token);
    await f.store.saveRoundJudgingResult(
      claim.scope,
      claim.token,
      ruling('negative'),
      { inputTokens: 1, outputTokens: 1 },
    );
  }
  await f.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 hour' where round_id=${roundId}`;
  await passAttendanceCutoff(f.sql, roundId, 3600);
  return roundId;
}

test('a held ballot dropped at its bound is reported once, with the reason', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await jobPastBudget(f, true);
    await seedSettledAttendanceLedger(f, roundId);
    await f.sql`update round_commands set applied_at=clock_timestamp()-interval '1 hour' where round_id=${roundId} and type='adjudicate'`;
    const reported: string[] = [];
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const maintenance = createRoundMaintenanceOperations({
      store: f.store,
      instanceId,
      ids: { next: createId },
      ratingFailed: () => {},
      evaluate: async () => null,
      startHorizonMs: 60_000,
      probeRoundId: null,
      judgingEnded: (reason) => reported.push(reason),
    });
    await maintenance.finalize(roundId);
    await maintenance.finalize(roundId);
    const [job] =
      await f.sql`select status,terminal_reason from round_judging_jobs where round_id=${roundId}`;
    await f.sql`delete from service_instances where instance_id=${instanceId}`;
    const done = (await f.store.getRound(roundId))!;
    assert({
      given: 'a held ballot that never submitted, past every bound',
      should: 'end the job, end the Round with no winner, and report it once',
      actual: { job, reported, done: [done.status, done.outcome] },
      expected: {
        job: { status: 'failed', terminal_reason: 'ballot_hold_ended' },
        reported: ['ballot_hold_ended'],
        done: ['completed', null],
      },
    });
  }, judgingOptions);
});

for (const { holds, reason } of [
  { holds: true, reason: 'ballot_hold_ended' },
  { holds: false, reason: 'generation_deadline' },
])
  test(`the abandoned path reports a job it ends ${holds ? 'holding a ballot' : 'past its budget'}`, async () => {
    await withRoomRuntime(async (f) => {
      const roundId = await jobPastBudget(f, holds);
      const reported: string[] = [];
      const instanceId = createId();
      await f.store.renewServiceInstance({ instanceId, role: 'web' });
      const attendance = createAttendanceFeature({
        checkIns: f.store,
        evaluate: f.store.evaluateRoundAttendance,
        nextId: createId,
        instanceId,
        judgingEnded: (ended) => reported.push(ended),
      });
      for (let pass = 0; pass < 8; pass++) {
        const decided = await attendance.evaluate(roundId);
        if (!decided || decided.decision === 'abandoned') break;
      }
      const [job] =
        await f.sql`select terminal_reason from round_judging_jobs where round_id=${roundId}`;
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
      assert({
        given:
          'no attendance evidence past the cutoff, and an open judging job',
        should: 'end the Round abandoned and report the job once',
        actual: {
          status: (await f.store.getRound(roundId))!.status,
          reason: job.terminal_reason,
          reported,
        },
        expected: { status: 'abandoned', reason, reported: [reason] },
      });
    }, judgingOptions);
  });

test('a forfeit cutting off a held ballot ends it round_ended and reports nothing (ISSUE-945)', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await jobPastBudget(f, true);
    await proveFirstSpeakerAbsent(f, roundId);
    const reported: string[] = [];
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const attendance = createAttendanceFeature({
      checkIns: f.store,
      evaluate: f.store.evaluateRoundAttendance,
      nextId: createId,
      instanceId,
      judgingEnded: (ended) => reported.push(ended),
    });
    try {
      const decided = await attendance.evaluate(roundId);
      const [job] =
        await f.sql`select terminal_reason from round_judging_jobs where round_id=${roundId}`;
      assert({
        given: 'settled evidence of an absence, and a job holding a ballot',
        should: 'forfeit, end the job round_ended, and report nothing',
        actual: {
          decision: decided?.decision,
          reason: job.terminal_reason,
          reported,
        },
        expected: { decision: 'forfeit', reason: 'round_ended', reported: [] },
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
      await f.sql`delete from availability_samples where at>=clock_timestamp()-interval '5 hours'`;
    }
  }, judgingOptions);
});

/** A first speaker settled evidence proves absent: their opponent attended, service healthy. */
async function proveFirstSpeakerAbsent(f: Fixture, roundId: string) {
  const round = (await f.store.getRound(roundId))!;
  const segment = round.segments.find((s) => s.type === 'speech')!;
  const rule = round.rules.segments.find(
    (s) => s.key === segment.rulesSegmentKey,
  )!;
  if (rule.type !== 'speech') throw Error('Expected a speech');
  const opponent = round.participants.find(
    (p) => p.role !== rule.side && p.role !== 'judge',
  )!;
  const commandId = createId();
  await f.sql`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,result,resulting_version,applied_at)
    values(${commandId},${roundId},${opponent.actorId},'check_in',${'a'.repeat(64)},${{}},1,statement_timestamp())`;
  await f.sql`insert into round_check_ins(command_id,round_id,segment_id,participant_id,received_at)
    select ${commandId},${roundId},id,${opponent.id},started_at+interval '1 second' from round_segments where id=${segment.id}`;
  await f.sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(59003)`;
    await tx`insert into availability_samples(at,healthy,cause)
      select s.started_at+n*interval '1 second',true,null
      from round_segments s, generate_series(-3,47) n where s.id=${segment.id}`;
  });
}

test('a forfeit on an incomplete freeze still has a rating coming', async () => {
  await withRoomRuntime(async (f) => {
    const { room } = await readyTwoHumanJudgeRoom(f);
    const { roundId } = await startRuntimeRound(f, room);
    await f.sql`update rounds set competition_type='ranked',format_id='freestyle',format_version=1,preset_version=1,ladder_id='freestyle' where id=${roundId}`;
    await playOut(f, roundId, false);
    if ((await finalizeAsWeb(f, roundId)).status !== 'frozen')
      throw Error('Expected actual finalizer freeze');
    await proveFirstSpeakerAbsent(f, roundId);
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const attendance = createAttendanceFeature({
      checkIns: f.store,
      evaluate: f.store.evaluateRoundAttendance,
      nextId: createId,
      instanceId,
    });
    try {
      const decided = await attendance.evaluate(roundId);
      assert({
        given: 'a provable absence deciding a ranked Round frozen incomplete',
        should: 'answer that the writer would still rate it',
        actual: {
          decision: decided?.decision,
          awaits: await f.store.readRoundAwaitsRating(roundId),
        },
        expected: { decision: 'forfeit', awaits: true },
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
      await f.sql`delete from availability_samples where at>=clock_timestamp()-interval '3 hours'`;
      await f.sql`delete from outbox where topic=${buildRoundTopic(roundId)}`;
      await f.sql`delete from rounds where id=${roundId}`;
    }
  });
});

for (const { pastBudget, reason, reported } of [
  { pastBudget: false, reason: 'round_ended', reported: [] },
  {
    pastBudget: true,
    reason: 'generation_deadline',
    reported: ['generation_deadline'],
  },
])
  test(`a forfeit cutting off a job ${pastBudget ? 'past' : 'inside'} its budget reports ${reported.length ? 'the budget' : 'nothing'}`, async () => {
    await withRoomRuntime(async (f) => {
      const { roundId } = await freezeBotJudge(f);
      if (pastBudget)
        await f.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      await proveFirstSpeakerAbsent(f, roundId);
      const ended: string[] = [];
      const instanceId = createId();
      await f.store.renewServiceInstance({ instanceId, role: 'web' });
      const attendance = createAttendanceFeature({
        checkIns: f.store,
        evaluate: f.store.evaluateRoundAttendance,
        nextId: createId,
        instanceId,
        judgingEnded: (why) => ended.push(why),
      });
      try {
        const decided = await attendance.evaluate(roundId);
        const [job] =
          await f.sql`select terminal_reason from round_judging_jobs where round_id=${roundId}`;
        assert({
          given: 'a provable absence with an open judging job',
          should: 'report only an ending that is not the forfeit itself',
          actual: {
            decision: decided?.decision,
            reason: job.terminal_reason,
            ended,
          },
          expected: { decision: 'forfeit', reason, ended: reported },
        });
      } finally {
        await f.sql`delete from service_instances where instance_id=${instanceId}`;
        await f.sql`delete from availability_samples where at>=clock_timestamp()-interval '3 hours'`;
      }
    }, judgingOptions);
  });
