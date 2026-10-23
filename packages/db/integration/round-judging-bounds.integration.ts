import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withJudgingJob } from './round-judging.test-support';
setupRitewayBun();
requireTestServices(process.env);

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
      dispatched.push(
        (await jobs.beginModelCall(claim.scope, claim.token)) !== null,
      );
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

test('a judging job past its ballot deadline buys no model call', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    await fixture.sql`update rounds set ballot_deadline_at=clock_timestamp()-interval '1 second' where id=${roundId}`;
    const claim = await jobs.claim(target);
    const begun = await jobs.beginModelCall(claim.scope, claim.token);
    const [job] =
      await fixture.sql`select status from round_judging_jobs where round_id=${roundId}`;
    assert({
      given: 'a judging job claimed after the ballot deadline',
      should: 'refuse the model call and end the job failed',
      actual: { begun, status: job.status },
      expected: { begun: null, status: 'failed' },
    });
  });
});
