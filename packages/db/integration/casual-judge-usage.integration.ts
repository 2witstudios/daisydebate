import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { withJudgingJob } from './round-judging.test-support';
import { createBotSeat } from './bot-seat.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('casual judge counts once at first model dispatch, not claim, and retains attribution', async () => {
  await withJudgingJob(async ({ fixture: f, roundId, target, jobs }) => {
    const [original] =
      await f.sql`select id,source,state from usage_reservations where round_id=${roundId}`;
    const claim = await jobs.claim(target);
    const [claimed] =
      await f.sql`select state from usage_reservations where id=${original.id}`;
    await jobs.beginModelCall(claim.scope, claim.token);
    const [counted] =
      await f.sql`select source,state from usage_reservations where id=${original.id}`;
    await assertRejects({
      given: 'the same dispatched judge attempt retried',
      should: 'refuse another model call',
      code: 'CONFLICT',
      actual: () => jobs.beginModelCall(claim.scope, claim.token),
    });
    const [after] =
      await f.sql`select source,state from usage_reservations where id=${original.id}`;
    assert({
      given:
        'a casual judge reservation followed by claim, actual first dispatch and duplicate',
      should:
        'count only once before model I/O and preserve the original source and count',
      actual: [claimed.state, counted.state.kind, counted.source, after],
      expected: [{ kind: 'reserved' }, 'dispatched', original.source, counted],
    });
  });
});

test('revoked casual judge sponsor cannot dispatch an old reservation', async () => {
  await withJudgingJob(async ({ fixture: f, roundId, target, jobs }) => {
    const claim = await jobs.claim(target);
    await f.sql`update account_beta_access set state='revoked',revision=revision+1 where user_id=(
      select a.user_id from rounds r join actors a on a.id=r.created_by_actor_id where r.id=${roundId})`;
    await assertRejects({
      given:
        'a valid judge lease and reservation after current participant revocation',
      should: 'refuse first model dispatch',
      code: 'AUTHORIZATION',
      actual: () => jobs.beginModelCall(claim.scope, claim.token),
    });
    const [after] =
      await f.sql`select u.state,(select count(*)::int from round_judging_attempts where round_id=${roundId}) as attempts
      from usage_reservations u where round_id=${roundId}`;
    assert({
      given: 'the refused judge dispatch',
      should: 'leave reservation and provider attempts unchanged',
      actual: after,
      expected: { state: { kind: 'reserved' }, attempts: 0 },
    });
  });
});

for (const outcome of ['provider_refused', 'timeout'] as const) {
  test(`casual judge terminal ${outcome} retains honest relief and late evidence`, async () => {
    await withJudgingJob(async ({ fixture: f, roundId, target, jobs }) => {
      const claim = await jobs.claim(target);
      await jobs.beginModelCall(claim.scope, claim.token);
      const [original] =
        await f.sql`select source,state from usage_reservations where round_id=${roundId}`;
      await jobs.recordAttemptFailure(claim.scope, claim.token, {
        diagnostic: {
          category: outcome,
          finish: 'none',
          issueCount: 0,
          issues: [],
        },
        final: true,
      });
      const [settled] =
        await f.sql`select source,state from usage_reservations where round_id=${roundId}`;
      assert({
        given: `a counted casual judge whose terminal provider result is ${outcome}`,
        should:
          'refund only definite failure, retain unknown exposure and preserve original attribution/count',
        actual: [settled.source, settled.state.kind, settled.state.countedAt],
        expected: [
          original.source,
          outcome === 'provider_refused' ? 'refunded' : 'unknown',
          original.state.countedAt,
        ],
      });
      if (outcome === 'timeout') {
        await jobs.recordUsage(claim.scope, claim.token, {
          inputTokens: 7,
          outputTokens: 3,
        });
        await jobs.recordUsage(claim.scope, claim.token, {
          inputTokens: 7,
          outputTokens: 3,
        });
        const [late] =
          await f.sql`select u.source,u.state,a.input_tokens,a.output_tokens from usage_reservations u
          join agent_runs a on a.id=${claim.scope.agentRunId} where u.round_id=${roundId}`;
        assert({
          given:
            'a terminal unknown attempt with later authenticated served accounting, twice',
          should: 'resolve delivery and cost without refund or re-count',
          actual: late,
          expected: {
            source: original.source,
            state: {
              kind: 'delivered',
              countedAt: original.state.countedAt,
              countBasis: 'dispatch_record',
            },
            input_tokens: 7,
            output_tokens: 3,
          },
        });
      } else {
        await assertRejects({
          given: 'a provider-refused attempt after terminal refund',
          should: 'reject contradictory served evidence',
          code: 'CONFLICT',
          actual: () =>
            jobs.recordUsage(claim.scope, claim.token, {
              inputTokens: 7,
              outputTokens: 3,
            }),
        });
        const [unchanged] =
          await f.sql`select source,state from usage_reservations where round_id=${roundId}`;
        assert({
          given: 'rejected contradictory late evidence',
          should: 'preserve the one original refund',
          actual: unchanged,
          expected: settled,
        });
      }
    });
  });
}

test('casual judge allowance waits for every frozen AI judge before terminal settlement', async () => {
  await withJudgingJob(async ({ fixture: f, roundId, target, jobs }) => {
    const next = await createBotSeat(f, roundId, 'judge', 1);
    const first = await jobs.claim(target);
    await jobs.beginModelCall(first.scope, first.token);
    await jobs.recordAttemptFailure(first.scope, first.token, {
      diagnostic: {
        category: 'provider_refused',
        finish: 'none',
        issueCount: 0,
        issues: [],
      },
      final: true,
    });
    const [waiting] =
      await f.sql`select state from usage_reservations where round_id=${roundId}`;
    assert({
      given:
        'one terminal refused judge and another frozen AI judge without its job yet',
      should:
        'retain the counted allowance until the complete aggregate is terminal',
      actual: waiting.state.kind,
      expected: 'dispatched',
    });
    await f.sql`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status,generation_deadline_at)
      values(${roundId},${next.id},1,'queued',clock_timestamp()+interval '5 minutes')`;
    const second = await jobs.claim({ roundId, judgeParticipantId: next.id });
    await jobs.beginModelCall(second.scope, second.token);
    await jobs.recordAttemptFailure(second.scope, second.token, {
      diagnostic: {
        category: 'timeout',
        finish: 'none',
        issueCount: 0,
        issues: [],
      },
      final: true,
    });
    const [settled] =
      await f.sql`select state from usage_reservations where round_id=${roundId}`;
    assert({
      given:
        'the remaining frozen judge terminates with an unknown provider outcome',
      should: 'retain unknown exposure and the original count without relief',
      actual: settled.state,
      expected: { ...waiting.state, kind: 'unknown' },
    });
  });
});

test('ranked AI judge dispatch remains free with no Premium grant or usage reservation', async () => {
  await withJudgingJob(async ({ fixture: f, roundId, target, jobs }) => {
    await f.sql`delete from usage_reservations where round_id=${roundId}`;
    await f.sql`delete from account_entitlement_grants where user_id=(select a.user_id from rounds r join actors a on a.id=r.created_by_actor_id where r.id=${roundId})`;
    await f.sql`update rounds set competition_type='ranked',format_id='freestyle',format_version=1,preset_version=1,ladder_id='freestyle' where id=${roundId}`;
    const claim = await jobs.claim(target);
    const begun = await jobs.beginModelCall(claim.scope, claim.token);
    const [facts] =
      await f.sql`select (select count(*)::int from usage_reservations where round_id=${roundId}) as usage,
      (select count(*)::int from round_judging_attempts where round_id=${roundId}) as attempts`;
    assert({
      given:
        'an actual ranked judging job and admitted account without a paid grant or casual reservation',
      should: 'dispatch under the ranked rules without consuming allowance',
      actual: [begun.kind, facts],
      expected: ['dispatched', { usage: 0, attempts: 1 }],
    });
  });
});
