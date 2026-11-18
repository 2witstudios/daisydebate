import { judgedRound } from './judged-round.test-support';
import { loanRoundAssignmentInterface } from '../src/testing-round-assignment-interface';
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
        // The seeding below runs today's store code, which reads every `rounds`
        // column. A column a later folder adds is lent to the baseline for the
        // seeding alone and taken back before that folder applies.
        await f.sql`alter table rounds add column post_round_call boolean not null default false`;
        // Today's decoder also sees the future nullable league selection. The
        // predecessor owns no such selection; remove the loan before migrating.
        await f.sql`alter table rounds add column league_ladder_id text`;
        await f.sql`alter table rounds add column decision_release text not null default 'on_finalize'`;
        // ADR 0145's frozen seat draw, which the predecessor never wrote.
        await f.sql`alter table rounds add column seat_draw jsonb`;
        // TAB-6's seat and outcome columns too, beside the role and outcome
        // columns it backfills them from.
        await f.sql`alter table rounds add column winning_side text, add column ranking jsonb, add column judging jsonb`;
        await f.sql`alter table round_participants add column seat_kind text, add column side text`;
        await f.sql`alter table rounds add column ballot_definition_id text, add column ballot_definition_version integer`;
        await f.sql`alter table ballots add column speaker_ranks jsonb`;
        // Today's canonical grant decoder sees an empty future source interface;
        // no hosting grant or issuer is fabricated in this populated predecessor.
        await f.sql`alter table account_entitlement_grants add column hosting_version_id text, add column revoked_at timestamptz`;
        // ADR 0148's seat grant source names its club; the decoder reads it.
        await f.sql`alter table account_entitlement_grants add column organization_id text`;
        await f.sql`create table account_hosting_versions (
          id text,user_id text,source text,version integer,starts_at timestamptz,expires_at timestamptz,
          issuer_service_id text,issuer_operator_ref text,decision_reference text,
          subscription_id text,subscription_observed_at timestamptz,subscription_evidence jsonb,coverage jsonb)`;
        const removeAssignmentInterface = await loanRoundAssignmentInterface(
          f.sql,
        );
        const run = createBoundedTransaction({
          lane: testLane(f.sql, 4),
          now: performance.now,
        });
        const queuedId = await judgedRound(f),
          failedId = await judgedRound(f);
        // Seeded on the schema before ADR 0125's stage columns: no stage records.
        await seedJudgingIntent(
          f,
          queuedId,
          run,
          'complete',
          undefined,
          'first',
        );
        await seedJudgingIntent(
          f,
          failedId,
          run,
          'complete',
          undefined,
          'first',
        );
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
          await f.sql`alter table rounds drop column post_round_call, drop column league_ladder_id`;
          await f.sql`alter table rounds drop column decision_release`;
          await f.sql`alter table rounds drop column seat_draw`;
          await f.sql`alter table rounds drop column winning_side, drop column ranking, drop column judging`;
          await removeAssignmentInterface();
          await f.sql`alter table round_participants drop column seat_kind, drop column side`;
          await f.sql`alter table rounds drop column ballot_definition_id, drop column ballot_definition_version`;
          await f.sql`alter table ballots drop column speaker_ranks`;
          await f.sql`drop table account_hosting_versions`;
          await f.sql`alter table account_entitlement_grants drop column hosting_version_id, drop column revoked_at`;
          await f.sql`alter table account_entitlement_grants drop column organization_id`;
          await scratch.migrate(() => true);
          const after =
            await f.sql`select round_id,judge_participant_id,freeze_revision,status,attempts,generation_deadline_at,pending_ballot,pending_ballot_agent_run_id,pending_ballot_epoch,pending_ballot_received_at,terminal_reason from round_judging_jobs order by round_id,judge_participant_id`;
          const currentReservations =
            await f.sql`select id,actor_id,round_id,kind,source,state,reserved_at from usage_reservations order by id`;
          const currentFreezes =
            await f.sql`select round_id,revision,frontier,completeness from round_transcript_freezes order by round_id`;
          const [defaults] =
            await f.sql`select bool_and(generation_first_epoch=1 and last_claimed_at is null and recovery_reason is null) as untouched from round_judging_jobs`;
          assert({
            given:
              'historical queued, failed and held-ballot Rounds after the real tail migration',
            should:
              'leave every new league selection empty without inventing rating provenance',
            actual: Array.from(
              await f.sql`select id,league_ladder_id from rounds where id=any(${f.sql.array([queuedId, failedId, held.roundId], 'text')}::text[]) order by id`,
            ),
            expected: [queuedId, failedId, held.roundId]
              .sort()
              .map((id) => ({ id, league_ladder_id: null })),
          });
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
