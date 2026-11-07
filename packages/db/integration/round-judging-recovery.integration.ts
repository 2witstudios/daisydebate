import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { judgingPolicy } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  withJudgingJob,
  syntheticPendingBallot,
} from './round-judging.test-support';

setupRitewayBun();
requireTestServices(process.env);

const usage = { inputTokens: 10, outputTokens: 5 };
const failure = {
  diagnostic: {
    category: 'provider_error' as const,
    finish: 'none' as const,
    issueCount: 0,
    issues: [],
  },
  final: false,
};

test('a spent attempt window recovers after backoff without losing the obligation', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    for (let attempt = 0; attempt < judgingPolicy.maxPaidCalls; attempt++) {
      if (attempt)
        await fixture.sql`update round_judging_jobs set retry_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      const claim = await jobs.claim(target);
      await jobs.beginModelCall(claim.scope, claim.token);
      await jobs.recordAttemptFailure(claim.scope, claim.token, failure);
    }
    const [paused] =
      await fixture.sql`select status,terminal_reason,recovery_reason,retry_at is not null as scheduled from round_judging_jobs where round_id=${roundId}`;
    assert({
      given: 'two transient failed paid calls',
      should: 'persist scheduled recovery, not a terminal result',
      actual: { ...paused, discovered: (await jobs.scan(8)).length },
      expected: {
        status: 'recovering',
        terminal_reason: null,
        recovery_reason: 'attempt_window',
        scheduled: true,
        discovered: 0,
      },
    });
    await assertRejects({
      given: 'a direct claim before recovery is due',
      should: 'preserve backoff authority',
      actual: () => jobs.claim(target),
      code: 'CONFLICT',
    });
    await fixture.sql`update round_judging_jobs set retry_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    const next = await jobs.claim(target);
    assert({
      given: 'the due durable recovery after two paid failures',
      should: 'admit a bounded new window under the same freeze',
      actual: {
        call: await jobs.beginModelCall(next.scope, next.token),
        revision: next.scope.freezeRevision,
      },
      expected: { call: { kind: 'dispatched' }, revision: 1 },
    });
    await jobs.saveResult(
      next.scope,
      next.token,
      syntheticPendingBallot,
      usage,
    );
    const [saved] =
      await fixture.sql`select pending_ballot,terminal_reason from round_judging_jobs where round_id=${roundId}`;
    assert({
      given: 'the recovered validated provider reply',
      should: 'durably retain its ballot with no terminal failure',
      actual: saved,
      expected: {
        pending_ballot: syntheticPendingBallot,
        terminal_reason: null,
      },
    });
  });
});

test('a current validated reply survives its old generation deadline and a process takeover', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const first = await jobs.claim(target);
    await jobs.beginModelCall(first.scope, first.token);
    await fixture.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    assert({
      given: 'a still-authorized provider answer past the generation window',
      should: 'persist its validated ballot instead of discarding it',
      actual: await jobs.saveResult(
        first.scope,
        first.token,
        syntheticPendingBallot,
        usage,
      ),
      expected: { kind: 'held' },
    });
    await fixture.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    const second = await jobs.claim(target);
    const renewed = await jobs.renew(second.scope, second.token);
    assert({
      given: 'a replacement worker after lease expiry and the old deadline',
      should: 'recover the same ballot and retain submission authority',
      actual: { ballot: second.pendingBallot, renewed: renewed.kind },
      expected: { ballot: syntheticPendingBallot, renewed: 'renewed' },
    });
    await assertRejects({
      given: 'the old claimant after takeover',
      should: 'refuse stale authority even for a genuine reply',
      actual: () =>
        jobs.saveResult(
          first.scope,
          first.token,
          syntheticPendingBallot,
          usage,
        ),
      code: 'CONFLICT',
    });
    const [counts] =
      await fixture.sql`select count(*)::int n from round_judging_attempts where round_id=${roundId}`;
    assert({
      given: 'cached recovery across takeover',
      should: 'buy no second provider call',
      actual: counts.n,
      expected: 1,
    });
  });
});

test('finite lifetime spending blocks automatic calls without erasing recoverability', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    for (
      let attempt = 0;
      attempt < judgingPolicy.maxAutomaticPaidCalls;
      attempt++
    ) {
      await fixture.sql`update round_judging_jobs set retry_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      const claim = await jobs.claim(target);
      const call = await jobs.beginModelCall(claim.scope, claim.token);
      if (call.kind !== 'dispatched')
        throw new Error('Expected one admitted bounded provider call');
      await jobs.recordAttemptFailure(claim.scope, claim.token, failure);
    }
    const [state] =
      await fixture.sql`select status,recovery_reason,terminal_reason,pending_ballot from round_judging_jobs where round_id=${roundId}`;
    assert({
      given:
        'the complete finite automatic spending allowance consumed by failures',
      should:
        'retain an explicit blocked obligation, not produce an unsupported result',
      actual: state,
      expected: {
        status: 'blocked',
        recovery_reason: 'automatic_spend',
        terminal_reason: null,
        pending_ballot: null,
      },
    });
    await assertRejects({
      given: 'an automatically blocked recovery',
      should: 'refuse further automatic spending',
      actual: () => jobs.claim(target),
      code: 'CONFLICT',
    });
  });
});

test('a late failure callback cannot strand an already validated ballot', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const claim = await jobs.claim(target);
    await jobs.beginModelCall(claim.scope, claim.token);
    await jobs.saveResult(
      claim.scope,
      claim.token,
      syntheticPendingBallot,
      usage,
    );
    await jobs.recordAttemptFailure(claim.scope, claim.token, {
      ...failure,
      final: true,
    });
    const [saved] =
      await fixture.sql`select j.status,j.pending_ballot,a.outcome from round_judging_jobs j join round_judging_attempts a on a.agent_run_id=${claim.scope.agentRunId} where j.round_id=${roundId}`;
    assert({
      given:
        'a duplicate/out-of-order failure callback after a validated answer was saved',
      should:
        'preserve its successful attempt, ballot and current submission authority',
      actual: saved,
      expected: {
        status: 'leased',
        pending_ballot: syntheticPendingBallot,
        outcome: 'succeeded',
      },
    });
  });
});
