import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { testLane } from '../src/testing-lane';
import {
  seedJudgingIntent,
  syntheticPendingBallot,
} from './round-judging.test-support';
import {
  seedHistoricalJudge,
  originalAnswer,
} from './casual-judge-migration.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test(
  'the combined recovery tail preserves populated Billing main100 identity, held ballot and historical finality',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'relmain100');
    await scratch.create();
    try {
      await scratch.migrate((tag) => tag <= '20261107080513_fair_midnight');
      await withFixture(scratch.url, async (f) => {
        const run = createBoundedTransaction({
          lane: testLane(f.sql, 4),
          now: performance.now,
        });
        const queuedId = await f.round(),
          failedId = await f.round();
        await seedJudgingIntent(f, queuedId, run);
        await seedJudgingIntent(f, failedId, run);
        await f.sql`update round_judging_jobs set status='failed',terminal_reason='round_ended',generation_deadline_at=clock_timestamp()-interval '1 second' where round_id=${failedId}`;
        const held = await seedHistoricalJudge(f, 'live_received');
        try {
          await f.sql`update round_judging_jobs set pending_ballot=${syntheticPendingBallot},pending_ballot_agent_run_id=${held.execution!.scope.agentRunId},pending_ballot_epoch=1,pending_ballot_received_at=${new Date(originalAnswer)} where round_id=${held.roundId}`;
          const before =
            await f.sql`select round_id,judge_participant_id,freeze_revision,status,attempts,generation_deadline_at,pending_ballot,pending_ballot_agent_run_id,pending_ballot_epoch,pending_ballot_received_at,terminal_reason from round_judging_jobs order by round_id,judge_participant_id`;
          const reservations =
            await f.sql`select id,actor_id,round_id,kind,source,state,reserved_at from usage_reservations order by id`;
          const freezes =
            await f.sql`select round_id,revision,frontier,completeness from round_transcript_freezes order by round_id`;
          await scratch.migrate(() => true);
          const after =
            await f.sql`select round_id,judge_participant_id,freeze_revision,status,attempts,generation_deadline_at,pending_ballot,pending_ballot_agent_run_id,pending_ballot_epoch,pending_ballot_received_at,terminal_reason from round_judging_jobs order by round_id,judge_participant_id`;
          const currentReservations =
            await f.sql`select id,actor_id,round_id,kind,source,state,reserved_at from usage_reservations order by id`;
          const currentFreezes =
            await f.sql`select round_id,revision,frontier,completeness from round_transcript_freezes order by round_id`;
          const [defaults] =
            await f.sql`select bool_and(generation_first_epoch=1 and last_claimed_at is null and recovery_reason is null) as untouched from round_judging_jobs`;
          await f.sql`update round_judging_jobs set status='recovering',recovery_reason='attempt_window',retry_at=clock_timestamp()+interval '1 second' where round_id=${queuedId}`;
          const [states] =
            await f.sql`select (select status from round_judging_jobs where round_id=${queuedId}) as live,(select status from round_judging_jobs where round_id=${failedId}) as historical,(select count(*)::integer from transcription_recovery_enrollment_progress) as progress`;
          assert({
            given:
              'actual populated main100 with reserved casual-judge identity, queued obligation, held schema-validated synthetic ballot and already-failed historical job',
            should:
              'apply the forward combined tail without changing original evidence/accounting/finality, initialize no invented service history and admit recovery only for live work',
            actual: {
              jobs: Array.from(after),
              reservations: Array.from(currentReservations),
              freezes: Array.from(currentFreezes),
              defaults,
              states,
            },
            expected: {
              jobs: Array.from(before),
              reservations: Array.from(reservations),
              freezes: Array.from(freezes),
              defaults: { untouched: true },
              states: { live: 'recovering', historical: 'failed', progress: 1 },
            },
          });
        } finally {
          // Remove the owning Round before the fixture purges its referenced cached agent run.
          await f.sql`delete from rounds where id=any(${f.sql.array([queuedId, failedId, held.roundId], 'text')}::text[])`;
        }
      });
    } finally {
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);
