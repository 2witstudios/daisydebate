import {
  ballotSchema,
  caseMapSchema,
  judgingAttemptCategories,
  judgingAttemptDiagnosticSchema,
  judgingAttemptOutcomes,
  judgingTerminalReasons,
  judgingRecoveryReasons,
  judgingStages,
  storedBallotSchema,
  type JudgingRecoveryReason,
  type JudgingStage,
  type JudgingAttemptCategory,
  type JudgingAttemptOutcome,
  type JudgingTerminalReason,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumnNullable,
  jsonbIsObject,
  oneOf,
  timestampColumn,
} from './columns';
import { agentRuns } from './agent-runs';
import { ballots } from './ballots';
import { roundParticipants } from './round-participants';
import { roundTranscriptFreezes } from './round-transcript-freezes';

/** One fenced durable intent; attempt usage remains recorded in agent_runs. */
export const roundJudgingJobs = pgTable(
  'round_judging_jobs',
  {
    roundId: text('round_id').notNull(),
    freezeRevision: integer('freeze_revision').notNull(),
    commandId: text('command_id'),
    judgeParticipantId: text('judge_participant_id').notNull(),
    status: text('status')
      .$type<
        'queued' | 'leased' | 'recovering' | 'blocked' | 'succeeded' | 'failed'
      >()
      .notNull(),
    leaseTokenDigest: text('lease_token_digest'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
    attempts: integer('attempts').notNull().default(0),
    resultBallotId: text('result_ballot_id'),
    pendingBallot: jsonbColumnNullable('pending_ballot', ballotSchema),
    pendingBallotAgentRunId: text('pending_ballot_agent_run_id'),
    pendingBallotEpoch: integer('pending_ballot_epoch'),
    pendingBallotReceivedAt: timestampColumn('pending_ballot_received_at'),
    /**
     * Coherency judging's stage records (ADR 0125), kept after success as the
     * first-pass-against-final comparison: the first-pass ballot (or that its
     * one try failed) and the case map the final ballot was decided from.
     * Each is written once by its stage; retention and subject erasure clear
     * them. Their provenance is the stage's attempt row.
     */
    firstBallot: jsonbColumnNullable('first_ballot', storedBallotSchema),
    firstBallotReceivedAt: timestampColumn('first_ballot_received_at'),
    firstBallotFailed: boolean('first_ballot_failed').notNull().default(false),
    caseMap: jsonbColumnNullable('case_map', caseMapSchema),
    caseMapReceivedAt: timestampColumn('case_map_received_at'),
    /** The AI judging budget, persisted at the freeze (DEC-275). Bounds provider work only. */
    generationDeadlineAt: timestampColumn('generation_deadline_at').notNull(),
    /** The first lease epoch whose dispatch belongs to this bounded window. */
    generationFirstEpoch: integer('generation_first_epoch')
      .notNull()
      .default(1),
    /** Pinned by the first claim, so a deploy cannot change a job's model between attempts. */
    model: text('model'),
    /** The job is not claimable before this; set by a retryable attempt failure. */
    retryAt: timestampColumn('retry_at'),
    /** An actual service turn, retained even after this panel member finishes. */
    lastClaimedAt: timestampColumn('last_claimed_at'),
    /** Safe recovery cause; unlike a terminal reason, this does not end the obligation. */
    recoveryReason: text('recovery_reason').$type<JudgingRecoveryReason>(),
    terminalReason: text('terminal_reason').$type<JudgingTerminalReason>(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    jsonbIsObject('round_judging_jobs', table.pendingBallot),
    jsonbIsObject('round_judging_jobs', table.firstBallot),
    jsonbIsObject('round_judging_jobs', table.caseMap),
    check(
      'round_judging_jobs_first_ballot_check',
      sql`(${table.firstBallot} is null) = (${table.firstBallotReceivedAt} is null) and not (${table.firstBallot} is not null and ${table.firstBallotFailed})`,
    ),
    check(
      'round_judging_jobs_case_map_check',
      sql`(${table.caseMap} is null) = (${table.caseMapReceivedAt} is null)`,
    ),
    check(
      'round_judging_jobs_terminal_reason_check',
      sql`(${table.status} = 'failed') = (${table.terminalReason} is not null) and (${table.terminalReason} is null or ${oneOf(table.terminalReason, judgingTerminalReasons)})`,
    ),
    foreignKey({
      name: 'round_judging_jobs_pending_run_judge_fk',
      columns: [table.pendingBallotAgentRunId, table.judgeParticipantId],
      foreignColumns: [agentRuns.id, agentRuns.roundParticipantId],
    }).onDelete('no action'),
    index('round_judging_jobs_pending_run_judge_idx').on(
      table.pendingBallotAgentRunId,
      table.judgeParticipantId,
    ),
    check(
      'round_judging_jobs_pending_check',
      sql`(${table.pendingBallot} is null and ${table.pendingBallotAgentRunId} is null and ${table.pendingBallotEpoch} is null and ${table.pendingBallotReceivedAt} is null) or (${table.pendingBallot} is not null and ${table.pendingBallotAgentRunId} is not null and ${table.pendingBallotEpoch} is not null and ${table.pendingBallotEpoch} > 0 and ${table.pendingBallotEpoch} <= ${table.attempts} and ${table.pendingBallotReceivedAt} is not null and ${table.status} <> 'succeeded')`,
    ),
    primaryKey({ columns: [table.roundId, table.judgeParticipantId] }),
    uniqueIndex('round_judging_jobs_command_unique').on(table.commandId),
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
      oneOf(table.status, [
        'queued',
        'leased',
        'recovering',
        'blocked',
        'succeeded',
        'failed',
      ]),
    ),
    check(
      'round_judging_jobs_recovery_check',
      sql`(${table.status} in ('recovering','blocked')) = (${table.recoveryReason} is not null)
        and (${table.recoveryReason} is null or ${oneOf(table.recoveryReason, judgingRecoveryReasons)})
        and (${table.status} <> 'recovering' or ${table.retryAt} is not null)`,
    ),
    check(
      'round_judging_jobs_attempts_check',
      sql`${table.attempts} >= 0 and (${table.status} <> 'leased' or ${table.attempts} > 0)`,
    ),
    check(
      'round_judging_jobs_generation_epoch_check',
      sql`${table.generationFirstEpoch} >= 1 and ${table.generationFirstEpoch} <= ${table.attempts} + 1`,
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

/**
 * One provider dispatch, recorded before the call is sent. Every row but one
 * the vendor certainly refused may have cost money, including one a crash left
 * `dispatched`. Historical request counters also preserve calls missing an
 * attempt record; absence of an attempt never restores provider budget. Its diagnostic
 * holds allowlisted facts only: never a message, received value, transcript or
 * provider text.
 */
export const roundJudgingAttempts = pgTable(
  'round_judging_attempts',
  {
    agentRunId: text('agent_run_id').primaryKey(),
    roundId: text('round_id').notNull(),
    judgeParticipantId: text('judge_participant_id').notNull(),
    jobEpoch: integer('job_epoch').notNull(),
    model: text('model').notNull(),
    contractVersion: text('contract_version').notNull(),
    /** The coherency stage this call bought; every call before ADR 0125 was the final one. */
    stage: text('stage').$type<JudgingStage>().notNull().default('final'),
    outcome: text('outcome').$type<JudgingAttemptOutcome>().notNull(),
    /** When the provider's answer and usage were accounted. */
    answeredAt: timestampColumn('answered_at'),
    category: text('category').$type<JudgingAttemptCategory>(),
    diagnostic: jsonbColumnNullable(
      'diagnostic',
      judgingAttemptDiagnosticSchema,
    ),
    createdAt: createdAtColumn(),
  },
  (table) => [
    jsonbIsObject('round_judging_attempts', table.diagnostic),
    foreignKey({
      name: 'round_judging_attempts_job_fk',
      columns: [table.roundId, table.judgeParticipantId],
      foreignColumns: [
        roundJudgingJobs.roundId,
        roundJudgingJobs.judgeParticipantId,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'round_judging_attempts_run_judge_fk',
      columns: [table.agentRunId, table.judgeParticipantId],
      foreignColumns: [agentRuns.id, agentRuns.roundParticipantId],
    }).onDelete('cascade'),
    index('round_judging_attempts_job_idx').on(
      table.roundId,
      table.judgeParticipantId,
    ),
    index('round_judging_attempts_run_judge_idx').on(
      table.agentRunId,
      table.judgeParticipantId,
    ),
    check(
      'round_judging_attempts_stage_check',
      oneOf(table.stage, judgingStages),
    ),
    check(
      'round_judging_attempts_category_check',
      sql`${table.category} is null or ${oneOf(table.category, judgingAttemptCategories)}`,
    ),
    check(
      'round_judging_attempts_outcome_check',
      sql`${oneOf(table.outcome, judgingAttemptOutcomes)} and (${table.outcome} = 'failed') = (${table.category} is not null) and (${table.category} is null) = (${table.diagnostic} is null)`,
    ),
  ],
);
