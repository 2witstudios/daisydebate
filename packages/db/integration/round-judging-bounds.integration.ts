import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import type { JudgingAttemptDiagnostic } from '@daisy/protocol';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { readJudgingPanelFacts } from '../src/judging-panel-read';
import {
  syntheticPendingBallot,
  withJudgingJob,
} from './round-judging.test-support';
setupRitewayBun();
requireTestServices(process.env);

/** The Round's final speech ended long enough ago that its cutoff has passed. */
const playedOut = (
  fixture: Parameters<Parameters<typeof withJudgingJob>[0]>[0]['fixture'],
  roundId: string,
) =>
  fixture.sql`update rounds set final_segment_ended_at=ended.at,
    transcript_admission_cutoff=ended.at+interval '120 seconds',
    attendance_resolution_cutoff_at=ended.at+interval '60 minutes'
    from (select date_trunc('milliseconds',clock_timestamp())-interval '61 minutes' as at) ended where id=${roundId}`;

const expire = (
  fixture: Parameters<Parameters<typeof withJudgingJob>[0]>[0]['fixture'],
  roundId: string,
) =>
  fixture.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId} and status='leased'`;

test('a judging job buys at most two model calls across lease expiries, then ends failed', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const dispatched: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const claim = await jobs.claim(target).catch(() => null);
      if (!claim) break;
      dispatched.push(await jobs.beginModelCall(claim.scope, claim.token));
      await expire(fixture, roundId);
    }
    const [job] =
      await fixture.sql`select status,lease_expires_at from round_judging_jobs where round_id=${roundId}`;
    const [paid] =
      await fixture.sql`select count(*)::int n from agent_runs where kind='judging' and configuration_snapshot->>'providerOutcome' in ('unknown','received') and configuration_snapshot->>'roundId'=${roundId}`;
    assert({
      given:
        'a judging job whose model call never answers, its lease expiring after each dispatch',
      should:
        'dispatch twice, refuse a third dispatch, end the job failed and leave it out of discovery (ISSUE-461)',
      actual: {
        dispatched,
        status: job.status,
        leased: job.lease_expires_at !== null,
        paid: paid.n,
        discovered: (await jobs.scan(8)).length,
      },
      expected: {
        dispatched: [true, true, false],
        status: 'failed',
        leased: false,
        paid: 2,
        discovered: 0,
      },
    });
  });
});

test('a judging job past its AI budget buys no model call, whatever the human deadline says', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    await fixture.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    const claim = await jobs.claim(target);
    const begun = await jobs.beginModelCall(claim.scope, claim.token);
    const [job] =
      await fixture.sql`select status,terminal_reason from round_judging_jobs where round_id=${roundId}`;
    assert({
      given: 'a judging job claimed after its generation deadline (DEC-275)',
      should: 'refuse the model call and end the job with that reason',
      actual: { begun, status: job.status, reason: job.terminal_reason },
      expected: {
        begun: false,
        status: 'failed',
        reason: 'generation_deadline',
      },
    });
  });
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    await fixture.sql`update rounds set ballot_deadline_at=clock_timestamp()-interval '1 second' where id=${roundId}`;
    const claim = await jobs.claim(target);
    assert({
      given: 'a passed human ballot deadline and budget remaining',
      should: 'still allow the AI job to work: the two are separate concepts',
      actual: await jobs.beginModelCall(claim.scope, claim.token),
      expected: true,
    });
  });
});

const rejected: JudgingAttemptDiagnostic = {
  category: 'schema_rejected',
  finish: 'stop',
  issueCount: 1,
  issues: [{ field: 'reason', code: 'too_big', limit: 600 }],
};
const usage = { inputTokens: 10, outputTokens: 5 };

test('the failed final permitted call ends the job on that call, not on a later claim', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const first = await jobs.claim(target);
    await jobs.beginModelCall(first.scope, first.token);
    await jobs.recordUsage(first.scope, first.token, usage);
    const afterFirst = await jobs.recordAttemptFailure(
      first.scope,
      first.token,
      {
        diagnostic: rejected,
        contractVersion: 'judge-contract@1',
        definite: false,
        final: false,
      },
    );
    const [waiting] =
      await fixture.sql`select status,retry_at is not null as backing_off,lease_expires_at from round_judging_jobs where round_id=${roundId}`;
    const hidden = await jobs.scan(8);
    await fixture.sql`update round_judging_jobs set retry_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    const second = await jobs.claim(target);
    await jobs.beginModelCall(second.scope, second.token);
    const afterSecond = await jobs.recordAttemptFailure(
      second.scope,
      second.token,
      {
        diagnostic: rejected,
        contractVersion: 'judge-contract@1',
        definite: false,
        final: false,
      },
    );
    const [job] =
      await fixture.sql`select status,terminal_reason,attempts,lease_expires_at from round_judging_jobs where round_id=${roundId}`;
    const [counts] =
      await fixture.sql`select (select count(*)::int from round_judging_attempts where round_id=${roundId}) as attempts,
        (select sum(requests)::int from agent_runs where kind='judging' and round_participant_id=${target.judgeParticipantId}) as requests,
        (select count(*)::int from agent_runs where kind='judging' and ended_at is null and round_participant_id=${target.judgeParticipantId}) as open`;
    assert({
      given: 'two rejected answers',
      should:
        'back off after the first, then end attempts_exhausted at once, with two calls, two attempts and no open run',
      actual: {
        afterFirst,
        backingOff: waiting.backing_off,
        hidden: hidden.length,
        afterSecond,
        status: job.status,
        reason: job.terminal_reason,
        leased: job.lease_expires_at !== null,
        epochs: job.attempts,
        ...counts,
        discovered: (await jobs.scan(8)).length,
      },
      expected: {
        afterFirst: 'retry',
        backingOff: true,
        hidden: 0,
        afterSecond: 'attempts_exhausted',
        status: 'failed',
        reason: 'attempts_exhausted',
        leased: false,
        epochs: 2,
        attempts: 2,
        requests: 2,
        open: 0,
        discovered: 0,
      },
    });
    const [row] =
      await fixture.sql`select diagnostic,category,contract_version from round_judging_attempts where round_id=${roundId} limit 1`;
    assert({
      given: 'a recorded attempt',
      should: 'hold the allowlisted diagnostic and contract version',
      actual: {
        category: row.category,
        version: row.contract_version,
        field: row.diagnostic.issues[0].field,
      },
      expected: {
        category: 'schema_rejected',
        version: 'judge-contract@1',
        field: 'reason',
      },
    });
  });
});

test('a call the vendor certainly refused buys nothing; an uncertain one still counts', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const attempt = async (definite: boolean) => {
      await fixture.sql`update round_judging_jobs set retry_at=null where round_id=${roundId}`;
      const claim = await jobs.claim(target);
      await jobs.beginModelCall(claim.scope, claim.token);
      return jobs.recordAttemptFailure(claim.scope, claim.token, {
        diagnostic: {
          category: definite ? 'provider_refused' : 'provider_error',
          finish: 'none',
          issueCount: 0,
          issues: [],
        },
        contractVersion: 'judge-contract@1',
        definite,
        final: false,
      });
    };
    assert({
      given: 'three definite refusals then two uncertain failures',
      should: 'end only on the second uncertain failure',
      actual: [
        await attempt(true),
        await attempt(true),
        await attempt(true),
        await attempt(false),
        await attempt(false),
      ],
      expected: ['retry', 'retry', 'retry', 'retry', 'attempts_exhausted'],
    });
  });
});

test('the budget fences an active lease: renewal cancels, and a late answer gains no authority but keeps its usage', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const claim = await jobs.claim(target);
    await jobs.beginModelCall(claim.scope, claim.token);
    await fixture.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    assert({
      given: 'a renewal after the budget',
      should: 'answer null so the worker cancels',
      actual: await jobs.renew(claim.scope, claim.token),
      expected: null,
    });
    const [job] =
      await fixture.sql`select status,terminal_reason from round_judging_jobs where round_id=${roundId}`;
    assert({
      given: 'that renewal',
      should: 'end the job durably',
      actual: { status: job.status, reason: job.terminal_reason },
      expected: { status: 'failed', reason: 'generation_deadline' },
    });
  });
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const claim = await jobs.claim(target);
    await jobs.beginModelCall(claim.scope, claim.token);
    await fixture.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    const saved = await jobs.saveResult(
      claim.scope,
      claim.token,
      syntheticPendingBallot,
      usage,
    );
    const [job] =
      await fixture.sql`select status,pending_ballot from round_judging_jobs where round_id=${roundId}`;
    const [run] =
      await fixture.sql`select input_tokens from agent_runs where id=${claim.scope.agentRunId}`;
    assert({
      given: 'a valid answer arriving after the budget',
      should: 'keep its usage, hold no ballot and end the job',
      actual: {
        saved,
        status: job.status,
        held: job.pending_ballot !== null,
        tokens: run.input_tokens,
      },
      expected: {
        saved: false,
        status: 'failed',
        held: false,
        tokens: usage.inputTokens,
      },
    });
  });
});

test('a held ballot outlives the budget, and a retry takes no new call', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const claim = await jobs.claim(target);
    await jobs.beginModelCall(claim.scope, claim.token);
    await jobs.saveResult(
      claim.scope,
      claim.token,
      syntheticPendingBallot,
      usage,
    );
    await fixture.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    const renewed = await jobs.renew(claim.scope, claim.token);
    const verified = await jobs.verify(claim.scope, claim.token);
    assert({
      given: 'a validated pending ballot after the budget (DEC-275)',
      should:
        'keep the lease and the ballot: the budget bounds generation only',
      actual: {
        renewed: renewed !== null,
        held: verified.pendingBallot !== null,
      },
      expected: { renewed: true, held: true },
    });
  });
});

test('the first claim pins the model for later attempts', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const first = await jobs.claim(target);
    await fixture.sql`update round_judging_jobs set model='pinned/model' where round_id=${roundId}`;
    await expire(fixture, roundId);
    const second = await jobs.claim(target);
    assert({
      given: 'a job already pinned to a model',
      should: 'use that model, not the current configuration',
      actual: { first: first.model, second: second.model },
      expected: {
        first: 'anthropic/claude-sonnet-5.5',
        second: 'pinned/model',
      },
    });
  });
});

test('a refusal that cannot heal ends the job at once, having bought nothing', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const claim = await jobs.claim(target);
    await jobs.beginModelCall(claim.scope, claim.token);
    const next = await jobs.recordAttemptFailure(claim.scope, claim.token, {
      diagnostic: {
        category: 'provider_refused',
        finish: 'none',
        issueCount: 0,
        issues: [],
      },
      contractVersion: 'judge-contract@1',
      definite: true,
      final: true,
    });
    const [job] =
      await fixture.sql`select status,terminal_reason from round_judging_jobs where round_id=${roundId}`;
    const [paid] =
      await fixture.sql`select count(*)::int as n from agent_runs where id=${claim.scope.agentRunId} and configuration_snapshot->>'providerOutcome' in ('unknown','received')`;
    assert({
      given: 'no endpoint able to serve the request',
      should: 'end now, not retry for the whole budget, and count no paid call',
      actual: {
        next,
        status: job.status,
        reason: job.terminal_reason,
        paid: paid.n,
      },
      expected: {
        next: 'provider_refused',
        status: 'failed',
        reason: 'provider_refused',
        paid: 0,
      },
    });
  });
});

test('a held ballot outlives the cutoff until it has had its chance to submit', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const claim = await jobs.claim(target);
    await jobs.beginModelCall(claim.scope, claim.token);
    await jobs.saveResult(
      claim.scope,
      claim.token,
      syntheticPendingBallot,
      usage,
    );
    const facts = () =>
      readJudgingPanelFacts(drizzle({ client: fixture.sql }), {
        roundId,
        completeness: 'complete',
        seats: [],
      });
    await assertRejects({
      given: 'a frozen Round with no cutoff',
      should: 'refuse rather than hold the ballot without end',
      actual: facts,
      code: 'INVARIANT',
    });
    await playedOut(fixture, roundId);
    const before = (await facts()).held;
    const attemptId = createId();
    await fixture.sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,backend_pid,backend_started_at)
      select ${attemptId},${createId()},${roundId},${'b'.repeat(64)},actor_id,1,'2026-10-22 00:00:00+00' from round_participants where round_id=${roundId} limit 1`;
    await fixture.sql`update round_check_in_attempts set state='aborted',resolved_at=clock_timestamp() where attempt_id=${attemptId}`;
    const after = (await facts()).held;
    await fixture.sql`delete from round_check_in_attempts where attempt_id=${attemptId}`;
    assert({
      given: 'a held ballot, then an uncertain writer resolving',
      should:
        'read the cutoff and the writer, for the engine to bound the hold by',
      actual: {
        cutoff: before.attendanceCutoffAt === after.attendanceCutoffAt,
        before: before.lastWriterResolvedAt,
        resolved: after.lastWriterResolvedAt !== null,
      },
      expected: { cutoff: true, before: null, resolved: true },
    });
  });
});

test('a fresh attendance decision also gives a held ballot its chance', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const claim = await jobs.claim(target);
    await jobs.beginModelCall(claim.scope, claim.token);
    await jobs.saveResult(
      claim.scope,
      claim.token,
      syntheticPendingBallot,
      usage,
    );
    await playedOut(fixture, roundId);
    const lastDecision = async () =>
      (
        await readJudgingPanelFacts(drizzle({ client: fixture.sql }), {
          roundId,
          completeness: 'complete',
          seats: [],
        })
      ).held.lastAttendanceDecisionAt;
    const before = await lastDecision();
    const segmentId = createId();
    await fixture.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: 'first',
      started_at: new Date(),
      duration_ms: 60_000,
    });
    const commandId = createId();
    await fixture.insert('round_commands', {
      command_id: commandId,
      round_id: roundId,
      service_id: `round-attendance:${createId()}`,
      type: 'adjudicate',
      payload_digest: 'a'.repeat(64),
      result: {},
      resulting_version: 1,
      applied_at: new Date(),
    });
    await fixture.insert('round_attendance_adjudications', {
      round_id: roundId,
      segment_id: segmentId,
      command_id: commandId,
      decision: 'none',
      effective_deadline: new Date(),
      settled_horizon: new Date(),
    });
    assert({
      given: 'a held ballot past the cutoff, then a new attendance decision',
      should: 'read that decision, for the engine to bound the hold by',
      actual: [before, (await lastDecision()) !== null],
      expected: [null, true],
    });
  });
});
