import { z } from 'zod';
import { instantMs } from '@daisy/clock/instant';
import { roundSourceVoided } from './round-source-state';
import { createAppError } from '@daisy/errors';
import { startGateInstant } from '@daisy/protocol/round-start-policy';
import {
  roundStatusSchema,
  runtimeCheckpointSchema,
} from '@daisy/protocol/round';
import { eq, sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockMediaRound,
  mediaId,
  type MediaCaller,
} from './media-session-authority';
import { sampleRoundExecutionTime } from './round-execution-time';
import { mediaSessions } from './schema/media-sessions';
import { rounds } from './schema/rounds';
import { roundSegments } from './schema/round-segments';
import { reconcileClaim } from './media-reconcile-store';
import type { TxSource, Tx } from './tx';
import { query } from './raw-rows';
const activeSessionRow = z.object({
  round_id: z.string(),
  reconcile_started_at: z.date().nullable(),
  reconcile_owner: z.string().nullable(),
  reconcile_lease_until: z.date().nullable(),
  reconcile_epoch: z.int(),
  reconcile_request_version: z.int(),
  reconcile_last_pass_clean: z.boolean(),
  unsafe_at: z.date().nullable(),
  deletion_requested_at: z.date().nullable(),
  status: roundStatusSchema,
  source_voided: z.boolean(),
  final_segment_ended_at: z.date().nullable(),
  completed_at: z.date().nullable(),
  post_round_call: z.boolean(),
  post_round_call_opened_at: z.date().nullable(),
  room_vacant_since: z.date().nullable(),
  started_at: z.date().nullable(),
  updated_at: z.date(),
  runtime_state: runtimeCheckpointSchema,
  countdown_ms: z.int(),
  segment_total: z.int(),
  prep_budget_ms: z.int().nullable(),
  poi_max_ms: z.int().nullable(),
  last_sequence: z.int().nullable(),
  last_started_at: z.date().nullable(),
  last_ended_at: z.date().nullable(),
  last_duration_ms: z.int().nullable(),
  last_returned_ms: z.int().nullable(),
  now: z.date(),
});
type ActiveSessionRow = z.output<typeof activeSessionRow>;
const activeSession = (row: ActiveSessionRow) => {
  const { prep } = row.runtime_state;
  return {
    roundId: row.round_id,
    now: row.now.toISOString(),
    lastPassAt: row.reconcile_started_at?.toISOString() ?? null,
    roundChangedAt: row.updated_at.toISOString(),
    roundStatus: row.status,
    sourceVoided: row.source_voided,
    finalSegmentEndedAt: row.final_segment_ended_at?.toISOString() ?? null,
    postRoundCall: {
      optedIn: row.post_round_call,
      status: row.status,
      // The read lists only sessions that have not ended.
      sessionOpen: true,
      roundEndedAt: row.completed_at?.toISOString() ?? null,
      openedAt: row.post_round_call_opened_at?.toISOString() ?? null,
      vacantSince: row.room_vacant_since?.toISOString() ?? null,
    },
    unsafe: row.unsafe_at !== null || row.deletion_requested_at !== null,
    lastPassClean: row.reconcile_last_pass_clean,
    claimWait: claimWaitOf(
      reconcileClaim(
        {
          reconcileOwner: row.reconcile_owner,
          reconcileLeaseUntil: row.reconcile_lease_until,
          reconcileStartedAt: row.reconcile_started_at,
          reconcileEpoch: row.reconcile_epoch,
          reconcileRequestVersion: row.reconcile_request_version,
          unsafeAt: row.unsafe_at,
        },
        row.now,
        false,
      ),
    ),
    clock: {
      startedAt: row.started_at?.toISOString() ?? null,
      countdownMs: row.countdown_ms,
      segmentTotal: row.segment_total,
      prepBudgetMs: row.prep_budget_ms,
      activePrep:
        prep.phase === 'running'
          ? {
              startedAt: prep.started_at,
              consumedMs: row.runtime_state.prep_consumed_ms[prep.side] ?? 0,
            }
          : null,
      stops: row.runtime_state.clock_stops,
      prepEndedAt: prep.phase === 'lead' ? prep.ended_at : null,
      pointEndsAt:
        row.runtime_state.point_of_information.phase === 'speaking' &&
        row.poi_max_ms !== null
          ? instantMs(row.runtime_state.point_of_information.accepted_at) +
            row.poi_max_ms
          : null,
      startGateAt: row.runtime_state.start_gate
        ? startGateInstant(row.runtime_state.start_gate)
        : null,
      hold:
        row.runtime_state.incident.phase === 'none'
          ? null
          : {
              resumesAt:
                row.runtime_state.incident.phase === 'resuming'
                  ? row.runtime_state.incident.until
                  : null,
            },
      segmentCount: row.last_sequence === null ? 0 : row.last_sequence + 1,
      lastSegment:
        row.last_started_at &&
        row.last_duration_ms !== null &&
        row.last_returned_ms !== null
          ? {
              startedAt: row.last_started_at.toISOString(),
              endedAt: row.last_ended_at?.toISOString() ?? null,
              durationMs: row.last_duration_ms,
              returnedMs: row.last_returned_ms,
            }
          : null,
    },
  };
};
export function createMediaReconcileClaims(deps: {
  readonly database: TxSource;
  readonly run: BoundedTransaction;
  readonly locked: (
    tx: Tx,
    sessionId: string,
  ) => Promise<typeof mediaSessions.$inferSelect>;
  readonly pending: (
    tx: Tx,
    sessionId: string,
  ) => Promise<readonly { readonly id: string }[]>;
}) {
  return {
    async requestMediaReconcile(request: {
      readonly roundId: string;
      readonly caller?: MediaCaller;
    }) {
      return deps.run(async (tx) => {
        await lockMediaRound(tx, mediaId(request.roundId), request.caller);
        const [session] = await tx
          .select()
          .from(mediaSessions)
          .where(eq(mediaSessions.roundId, request.roundId))
          .for('update');
        if (!session) throw createAppError('NOT_FOUND');
        const now = new Date(await sampleRoundExecutionTime(tx));
        const version = session.reconcileRequestVersion + 1;
        await tx
          .update(mediaSessions)
          .set({ reconcileRequestedAt: now, reconcileRequestVersion: version })
          .where(eq(mediaSessions.id, session.id));
        return { sessionId: session.id, version };
      });
    },
    async claimMediaReconcile(request: {
      readonly sessionId: string;
      readonly owner: string;
    }) {
      mediaId(request.owner);
      return deps.run(async (tx) => {
        const session = await deps.locked(tx, request.sessionId);
        const now = new Date(await sampleRoundExecutionTime(tx));
        const claim = reconcileClaim(
          session,
          now,
          (await deps.pending(tx, session.id)).length > 0,
        );
        if (claim.kind === 'wait') return claim;
        const { epoch, unsafeAt } = claim;
        await tx
          .update(mediaSessions)
          .set({
            reconcileEpoch: epoch,
            reconcileOwner: request.owner,
            reconcileLeaseUntil: claim.leaseUntil,
            reconcileStartedAt: now,
            reconcileRunningVersion: claim.runningVersion,
            unsafeAt,
          })
          .where(eq(mediaSessions.id, session.id));
        return {
          kind: 'claimed' as const,
          fence: { sessionId: session.id, owner: request.owner, epoch },
          roundId: session.roundId,
          roomName: session.roomName,
          unsafe: unsafeAt !== null,
          runningVersion: claim.runningVersion,
        };
      });
    },
    async mediaReconcileProgress(sessionId: string) {
      const [session] = await deps.database
        .select({
          servedVersion: mediaSessions.reconcileServedVersion,
          unsafeAt: mediaSessions.unsafeAt,
          endedAt: mediaSessions.endedAt,
        })
        .from(mediaSessions)
        .where(eq(mediaSessions.id, mediaId(sessionId)));
      if (!session) throw createAppError('NOT_FOUND');
      return session;
    },
    /**
     * The recovery tick's one read: every active session and the facts that say
     * whether it needs a pass, longest since a pass first, at one sampled clock.
     */
    async activeMediaSessions() {
      const rows = await query(
        deps.database,
        activeSessionRow,
        sql`
        with clock as (select clock_timestamp() as now)
        select
          s.round_id,
          s.reconcile_started_at,
          s.reconcile_owner,
          s.reconcile_lease_until,
          s.reconcile_epoch,
          s.reconcile_request_version,
          s.reconcile_last_pass_clean,
          s.unsafe_at,
          s.deletion_requested_at,
          r.status,
          ${roundSourceVoided(sql`r.id`)} as source_voided,
          r.final_segment_ended_at,
          r.completed_at,
          r.post_round_call,
          s.post_round_call_opened_at,
          s.room_vacant_since,
          r.started_at,
          r.updated_at,
          r.runtime_state,
          (r.rules_snapshot->>'countdownMs')::int as countdown_ms,
          jsonb_array_length(r.rules_snapshot->'segments') as segment_total,
          (r.rules_snapshot#>>'{inRoundPrep,budgetMsPerSide}')::int as prep_budget_ms,
          (r.rules_snapshot#>>'{interaction,pointsOfInformation,maxDurationMs}')::int as poi_max_ms,
          last.sequence as last_sequence,
          last.started_at as last_started_at,
          last.ended_at as last_ended_at,
          last.duration_ms as last_duration_ms,
          last.returned_ms as last_returned_ms,
          clock.now
        from ${mediaSessions} s
        cross join clock
        join ${rounds} r on r.id = s.round_id
        left join lateral (
          select sequence, started_at, ended_at, duration_ms, returned_ms
          from ${roundSegments} seg
          where seg.round_id = s.round_id
          order by seg.sequence desc
          limit 1
        ) last on true
        where s.ended_at is null
        order by s.reconcile_started_at asc nulls first
      `,
      );
      return rows.map(activeSession);
    },
  };
}

/** What a claim on this session would wait for; null means it would succeed. */
const claimWaitOf = (claim: ReturnType<typeof reconcileClaim>) =>
  claim.kind === 'wait' ? claim.reason : null;
