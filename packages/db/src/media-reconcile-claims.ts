import { createAppError } from '@daisy/errors';
import type { RoundStatus, RuntimeCheckpoint } from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import {
  lockMediaRound,
  mediaId,
  type MediaCaller,
} from './media-session-authority';
import { sampleRoundExecutionTime } from './round-execution-time';
import { mediaSessions } from './schema/media-sessions';
import { rounds } from './schema/rounds';
import { roundSegments } from './schema/round-segments';
import { reconcileClaim } from './media-reconcile-rules';
type ActiveSessionRow = {
  readonly round_id: string;
  readonly reconcile_started_at: Date | null;
  readonly reconcile_owner: string | null;
  readonly reconcile_lease_until: Date | null;
  readonly reconcile_epoch: number;
  readonly reconcile_request_version: number;
  readonly reconcile_last_pass_clean: boolean;
  readonly unsafe_at: Date | null;
  readonly deletion_requested_at: Date | null;
  readonly status: RoundStatus;
  readonly final_segment_ended_at: Date | null;
  readonly started_at: Date | null;
  readonly updated_at: Date;
  readonly runtime_state: RuntimeCheckpoint;
  readonly countdown_ms: number;
  readonly segment_total: number;
  readonly prep_budget_ms: number | null;
  readonly last_sequence: number | null;
  readonly last_started_at: Date | null;
  readonly last_ended_at: Date | null;
  readonly last_duration_ms: number | null;
  readonly last_returned_ms: number | null;
  readonly now: Date;
};
const activeSession = (row: ActiveSessionRow) => {
  const prep = row.runtime_state.active_prep;
  return {
    roundId: row.round_id,
    now: row.now.toISOString(),
    lastPassAt: row.reconcile_started_at?.toISOString() ?? null,
    roundChangedAt: row.updated_at.toISOString(),
    roundStatus: row.status,
    finalSegmentEndedAt: row.final_segment_ended_at?.toISOString() ?? null,
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
      activePrep: prep
        ? {
            startedAt: prep.started_at,
            consumedMs: row.runtime_state.prep_consumed_ms[prep.side],
          }
        : null,
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
  readonly database: BunSQLDatabase;
  readonly run: BoundedTransaction;
  readonly locked: (
    tx: BoundedTransactionContext,
    sessionId: string,
  ) => Promise<typeof mediaSessions.$inferSelect>;
  readonly pending: (
    tx: BoundedTransactionContext,
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
      const rows = (await deps.database.execute(sql`
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
          r.final_segment_ended_at,
          r.started_at,
          r.updated_at,
          r.runtime_state,
          (r.rules_snapshot->>'countdownMs')::int as countdown_ms,
          jsonb_array_length(r.rules_snapshot->'segments') as segment_total,
          (r.rules_snapshot#>>'{inRoundPrep,budgetMsPerSide}')::int as prep_budget_ms,
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
      `)) as unknown as readonly ActiveSessionRow[];
      return rows.map(activeSession);
    },
  };
}

/** What a claim on this session would wait for; null means it would succeed. */
const claimWaitOf = (claim: ReturnType<typeof reconcileClaim>) =>
  claim.kind === 'wait' ? claim.reason : null;
