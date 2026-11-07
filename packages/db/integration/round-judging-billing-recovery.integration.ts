import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { judgingPolicy } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withJudgingJob } from './round-judging.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('an undispatched expired window retains its uncounted identity until bounded recovery dispatch', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const [original] =
      await fixture.sql`select id,state from usage_reservations where round_id=${roundId} and kind='casual_ai_judge'`;
    await fixture.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    const first = await jobs.claim(target);
    const deferred = await jobs.beginModelCall(first.scope, first.token);
    const [paused] =
      await fixture.sql`select id,state from usage_reservations where round_id=${roundId} and kind='casual_ai_judge'`;
    await fixture.sql`update round_judging_jobs set retry_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    const next = await jobs.claim(target);
    const dispatched = await jobs.beginModelCall(next.scope, next.token);
    const [counted] =
      await fixture.sql`select id,state->>'kind' as kind,state->>'countBasis' as basis from usage_reservations where round_id=${roundId} and kind='casual_ai_judge'`;
    assert({
      given:
        'a real reserved but uncounted judge identity and an expired original attempt window, followed by due recovery',
      should:
        'retain that identity while recovering, then count it once without a new reservation or stranded released debit',
      actual: { deferred, paused, dispatched, counted },
      expected: {
        deferred: { kind: 'deferred', reason: 'attempt_window' },
        paused: original,
        dispatched: { kind: 'dispatched' },
        counted: {
          id: original!.id,
          kind: 'dispatched',
          basis: 'dispatch_record',
        },
      },
    });
  });
});
test('unknown historical request counters still consume finite automatic judge funding when attempt metadata is absent', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const stamp = new Date();
    await fixture.insert('agent_runs', {
      id: createId(),
      round_participant_id: target.judgeParticipantId,
      kind: 'judging',
      provider: 'fixture',
      requests: judgingPolicy.maxAutomaticPaidCalls,
      started_at: stamp,
      ended_at: stamp,
    });
    const claim = await jobs.claim(target);
    const result = await jobs.beginModelCall(claim.scope, claim.token);
    const [row] =
      await fixture.sql`select status,recovery_reason from round_judging_jobs where round_id=${roundId}`;
    const [requests] =
      await fixture.sql`select sum(requests)::integer as count from agent_runs where round_participant_id=${target.judgeParticipantId} and kind='judging'`;
    const [identity] =
      await fixture.sql`select state->>'kind' as kind,state ? 'countedAt' as counted from usage_reservations where round_id=${roundId} and kind='casual_ai_judge'`;
    assert({
      given:
        'a synthetic historical started-request counter at the automatic lifetime limit, with no attempt receipt or invented provider outcome',
      should:
        'block another external-call authorization conservatively while preserving original uncounted service identity and pending recovery',
      actual: { result, row, requests, identity },
      expected: {
        result: { kind: 'deferred', reason: 'automatic_spend' },
        row: { status: 'blocked', recovery_reason: 'automatic_spend' },
        requests: { count: judgingPolicy.maxAutomaticPaidCalls },
        identity: { kind: 'reserved', counted: false },
      },
    });
  });
});
