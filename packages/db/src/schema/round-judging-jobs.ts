import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { ballots } from './ballots';
import { roundParticipants } from './round-participants';
import { roundTranscriptFreezes } from './round-transcript-freezes';

/** One fenced durable intent; attempt usage remains recorded in agent_runs. */
export const roundJudgingJobs = pgTable(
  'round_judging_jobs',
  {
    roundId: text('round_id').notNull(),
    freezeRevision: integer('freeze_revision').notNull(),
    judgeParticipantId: text('judge_participant_id').notNull(),
    status: text('status')
      .$type<'queued' | 'leased' | 'succeeded' | 'failed'>()
      .notNull(),
    leaseTokenDigest: text('lease_token_digest'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
    attempts: integer('attempts').notNull().default(0),
    resultBallotId: text('result_ballot_id'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.judgeParticipantId] }),
    foreignKey({
      name: 'round_judging_jobs_freeze_revision_fk',
      columns: [table.roundId, table.freezeRevision],
      foreignColumns: [
        roundTranscriptFreezes.roundId,
        roundTranscriptFreezes.revision,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'round_judging_jobs_judge_round_fk',
      columns: [table.judgeParticipantId, table.roundId],
      foreignColumns: [roundParticipants.id, roundParticipants.roundId],
    }).onDelete('no action'),
    foreignKey({
      name: 'round_judging_jobs_result_judge_fk',
      columns: [table.resultBallotId, table.judgeParticipantId],
      foreignColumns: [ballots.id, ballots.judgeParticipantId],
    }).onDelete('no action'),
    index('round_judging_jobs_freeze_revision_idx').on(
      table.roundId,
      table.freezeRevision,
    ),
    index('round_judging_jobs_judge_round_idx').on(
      table.judgeParticipantId,
      table.roundId,
    ),
    index('round_judging_jobs_result_judge_idx').on(
      table.resultBallotId,
      table.judgeParticipantId,
    ),
    index('round_judging_jobs_pending_idx').on(
      table.status,
      table.leaseExpiresAt,
    ),
    check(
      'round_judging_jobs_status_check',
      oneOf(table.status, ['queued', 'leased', 'succeeded', 'failed']),
    ),
    check(
      'round_judging_jobs_attempts_check',
      sql`${table.attempts} >= 0 and (${table.status} <> 'leased' or ${table.attempts} > 0)`,
    ),
    check(
      'round_judging_jobs_lease_check',
      sql`(${table.status} = 'leased' and ${table.leaseTokenDigest} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'leased' and ${table.leaseTokenDigest} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      'round_judging_jobs_token_digest_check',
      sql`${table.leaseTokenDigest} is null or ${table.leaseTokenDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'round_judging_jobs_result_check',
      sql`(${table.status} = 'succeeded') = (${table.resultBallotId} is not null)`,
    ),
  ],
);
