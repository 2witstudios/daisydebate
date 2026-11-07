import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotSeat } from './bot-seat.test-support';
import {
  seedJudgingIntent,
  syntheticPendingBallot,
  withJudgingJob,
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

test('cached discovery is independent of a full page of older uncached Rounds', async () => {
  await withJudgingJob(async ({ fixture, target, jobs }) => {
    const created: string[] = [];
    try {
      const older = [target.roundId];
      for (let at = 0; at < 64; at++) {
        const roundId = await fixture.round();
        created.push(roundId);
        await seedJudgingIntent(fixture, roundId);
        older.push(roundId);
      }
      const cachedId = await fixture.round();
      created.push(cachedId);
      const cached = await seedJudgingIntent(fixture, cachedId);
      const holder = await jobs.claim(cached);
      await jobs.beginModelCall(holder.scope, holder.token);
      await jobs.saveResult(
        holder.scope,
        holder.token,
        syntheticPendingBallot,
        usage,
      );
      await fixture.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${cachedId}`;
      for (let pass = 0; pass < 2; pass++) {
        const held = await jobs.scan(64, 'submission');
        const paid = await jobs.scan(64, 'generation');
        assert({
          given: `discovery pass ${pass + 1} with 65 older uncached Rounds and a later held reply`,
          should:
            'page held work independently and keep the bounded paid page separate',
          actual: {
            held: held.map((job) => job.roundId),
            paidCount: paid.length,
            paidOnly: paid.every(
              (job) => older.includes(job.roundId) && !job.holdsBallot,
            ),
          },
          expected: { held: [cachedId], paidCount: 64, paidOnly: true },
        });
      }
    } finally {
      for (const roundId of created.reverse())
        await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
});

test('concurrent judge claims serialize one active operation per Round', async () => {
  await withJudgingJob(async ({ fixture, roundId, target, jobs }) => {
    const other = await createBotSeat(fixture, roundId, 'judge', 1);
    await fixture.sql`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status,generation_deadline_at) values(${roundId},${other.id},1,'queued',clock_timestamp()+interval '5 minutes')`;
    const attempts = await Promise.allSettled([
      jobs.claim(target),
      jobs.claim({ roundId, judgeParticipantId: other.id }),
    ]);
    assert({
      given:
        'two workers concurrently claiming different judge seats of one Round',
      should: 'admit exactly one and refuse the other without buying a call',
      actual: {
        admitted: attempts.filter((r) => r.status === 'fulfilled').length,
        refused: attempts.filter(
          (r) =>
            r.status === 'rejected' &&
            isAppError(r.reason) &&
            r.reason.code === 'CONFLICT',
        ).length,
      },
      expected: { admitted: 1, refused: 1 },
    });
  });
});

test('reclaiming an expired operation moves its Round behind older due work', async () => {
  await withJudgingJob(async (first) => {
    await first.jobs.claim(first.target);
    await withJudgingJob(async (second) => {
      await first.fixture
        .sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${first.roundId}`;
      await first.jobs.claim(first.target);
      await first.fixture
        .sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${first.roundId}`;
      const due = await first.jobs.scan(8, 'generation');
      const ours = due.filter((item) =>
        [first.roundId, second.roundId].includes(item.roundId),
      );
      assert({
        given: 'an older job reclaimed after another Round became due',
        should: 'serve the waiting Round before reclaiming the same job again',
        actual: ours.map((item) => item.roundId),
        expected: [second.roundId, first.roundId],
      });
    });
  });
});

test('discovery pages eligible Rounds before a large panel can fill the batch', async () => {
  await withJudgingJob(async (panel) => {
    // A legal panel larger than the maximum discovery batch of 64.
    for (let slot = 1; slot <= 65; slot++) {
      const seat = await createBotSeat(
        panel.fixture,
        panel.roundId,
        'judge',
        slot,
      );
      await panel.fixture
        .sql`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status,generation_deadline_at) values(${panel.roundId},${seat.id},1,'queued',clock_timestamp()+interval '5 minutes')`;
    }
    await withJudgingJob(async (other) => {
      const relevant = (rows: Awaited<ReturnType<typeof other.jobs.scan>>) =>
        rows
          .filter((row) => [panel.roundId, other.roundId].includes(row.roundId))
          .map((row) => row.roundId);
      assert({
        given: '66 older due judges before another due Round and a batch of64',
        should:
          'discover both Rounds exactly once before applying the batch limit',
        actual: relevant(await other.jobs.scan(64, 'generation')),
        expected: [panel.roundId, other.roundId],
      });
      const holder = await panel.jobs.claim(panel.target);
      await panel.jobs.beginModelCall(holder.scope, holder.token);
      await panel.jobs.saveResult(
        holder.scope,
        holder.token,
        syntheticPendingBallot,
        usage,
      );
      assert({
        given: 'another worker holding one live claim in the large panel',
        should:
          'exclude all of that Round before LIMIT so its siblings cannot starve the unrelated Round',
        actual: relevant(await other.jobs.scan(64, 'generation')),
        expected: [other.roundId],
      });
      await panel.fixture
        .sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${panel.roundId} and status='leased'`;
      const resumed = relevant([
        ...(await other.jobs.scan(64, 'generation')),
        ...(await other.jobs.scan(64, 'submission')),
      ]);
      assert({
        given: 'the other worker claim subsequently expiring',
        should: 'make the panel discoverable once again without duplicating it',
        actual: { rounds: [...resumed].sort(), count: resumed.length },
        expected: { rounds: [panel.roundId, other.roundId].sort(), count: 2 },
      });
      const chosen = (await other.jobs.scan(64, 'submission')).find(
        (row) => row.roundId === panel.roundId,
      );
      assert({
        given:
          'a held reply with a newer service turn than its uncached panel siblings',
        should:
          'choose the cached submission within that Round so provider saturation cannot hide it',
        actual: {
          judge: chosen?.judgeParticipantId,
          held: chosen?.holdsBallot,
        },
        expected: { judge: panel.target.judgeParticipantId, held: true },
      });
    });
  });
});

test('finishing a panel member cannot reset its Round ahead of waiting work', async () => {
  await withJudgingJob(async (panel) => {
    const sibling = await createBotSeat(
      panel.fixture,
      panel.roundId,
      'judge',
      1,
    );
    await panel.fixture
      .sql`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status,generation_deadline_at) values(${panel.roundId},${sibling.id},1,'queued',clock_timestamp()+interval '5 minutes')`;
    await withJudgingJob(async (other) => {
      const claim = await panel.jobs.claim(panel.target);
      // An ended member no longer participates in the eligible-row partition,
      // but its actual service turn still belongs to the whole Round.
      await panel.fixture
        .sql`update round_judging_jobs set status='failed',terminal_reason='round_ended',lease_token_digest=null,lease_expires_at=null where round_id=${panel.roundId} and judge_participant_id=${claim.scope.judgeParticipantId}`;
      assert({
        given:
          'an older unclaimed sibling after its panel just received a service turn',
        should:
          'page the independently waiting Round first even with a batch of one',
        actual: (await other.jobs.scan(1, 'generation')).map(
          (row) => row.roundId,
        ),
        expected: [other.roundId],
      });
    });
  });
});

test('new arrivals cannot outrank an older service turn once its backoff is due', async () => {
  await withJudgingJob(async (older) => {
    const claim = await older.jobs.claim(older.target);
    await older.jobs.beginModelCall(claim.scope, claim.token);
    await older.jobs.recordAttemptFailure(claim.scope, claim.token, failure);
    for (let arrival = 0; arrival < 3; arrival++) {
      await withJudgingJob(async (newer) => {
        await older.fixture
          .sql`update round_judging_jobs set retry_at=clock_timestamp()-interval '1 millisecond' where round_id=${older.roundId}`;
        assert({
          given: `new arrival ${arrival + 1} beside an older already-served recovery now eligible`,
          should:
            'use actual service history rather than fresh retry eligibility or never-claimed priority',
          actual: (await newer.jobs.scan(1, 'generation')).map(
            (row) => row.roundId,
          ),
          expected: [older.roundId],
        });
      });
    }
  });
});
