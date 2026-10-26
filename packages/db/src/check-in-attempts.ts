import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { AttendanceTransactionContext } from './attendance-facts';
export type CheckInAttempt = {
  readonly attemptId: string;
  readonly commandId: string;
  readonly roundId: string;
  readonly payloadDigest: string;
  readonly actorId: string | null;
  readonly serviceId: string | null;
};
export type CheckInAttemptMetadata = {
  readonly receivedAt: string;
  readonly writer: { readonly pid: number; readonly backendStart: string };
};
/** Scoped DML only: the resource adapter owns the control transaction and its commit. */
export function checkInAttemptLifecycle(attempt: CheckInAttempt) {
  if (
    ![attempt.attemptId, attempt.commandId, attempt.roundId].every(
      (id) => idSchema.safeParse(id).success,
    ) ||
    !/^[0-9a-f]{64}$/.test(attempt.payloadDigest) ||
    (attempt.actorId === null) === (attempt.serviceId === null)
  )
    throw createAppError('VALIDATION');
  return {
    async open(
      control: AttendanceTransactionContext,
      metadata: CheckInAttemptMetadata,
    ): Promise<void> {
      await control.execute(sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,service_id,received_at,backend_pid,backend_started_at,state)
    values(${attempt.attemptId},${attempt.commandId},${attempt.roundId},${attempt.payloadDigest},${attempt.actorId},${attempt.serviceId},${metadata.receivedAt}::timestamptz,${metadata.writer.pid},${metadata.writer.backendStart}::timestamptz,'pending')`);
    },
    async close(
      control: AttendanceTransactionContext,
      metadata: CheckInAttemptMetadata,
      outcome: 'committed' | 'aborted',
    ): Promise<void> {
      // An abort closes only after the writer's absence is confirmed, and the
      // reconciler settles exactly such markers: one it already aborted for
      // this writer is the same verified fact (ISSUE-618). The CTE's plain
      // read sees the row as it was before this update.
      const rows =
        await control.execute(sql`with closed as (update round_check_in_attempts a set state=${outcome},resolved_at=statement_timestamp()
    where a.attempt_id=${attempt.attemptId} and a.state='pending' and a.backend_pid=${metadata.writer.pid}
     and a.backend_started_at=${metadata.writer.backendStart}::timestamptz
     and (${outcome}='aborted' or exists(select 1 from round_commands c where c.command_id=a.command_id and c.round_id=a.round_id
      and c.type='check_in' and c.payload_digest=a.payload_digest and c.actor_id is not distinct from a.actor_id and c.service_id is not distinct from a.service_id))
    returning a.attempt_id)
    select attempt_id from closed
    union all
    select a.attempt_id from round_check_in_attempts a where ${outcome}='aborted' and a.attempt_id=${attempt.attemptId}
     and a.state='aborted' and a.backend_pid=${metadata.writer.pid}
     and a.backend_started_at=${metadata.writer.backendStart}::timestamptz`);
      if (rows.length !== 1)
        throw createAppError(
          'INVARIANT',
          'Check-in marker closure was not durably confirmed',
        );
    },
  };
}
/** Backend absence AND fresh ledger identity settle an orphan. Leases/age are never proof. */
export async function reconcileCheckInAttempts(
  control: AttendanceTransactionContext,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw createAppError('VALIDATION');
  const absent =
    await control.execute(sql`select a.attempt_id from round_check_in_attempts a where a.state='pending'
    and not exists(select 1 from pg_stat_activity p where p.pid=a.backend_pid and p.backend_start=a.backend_started_at)
    order by a.received_at limit ${limit} for update skip locked`);
  const ids = (absent as unknown as { attempt_id: string }[]).map(
    (row) => row.attempt_id,
  );
  if (ids.length === 0) return 0;
  // A SECOND READ COMMITTED statement sees commits that preceded confirmed backend absence.
  // Combining pg_stat_activity and ledger reads in one MVCC snapshot can falsely call a commit aborted.
  const rows = await control.execute(sql`update round_check_in_attempts a set
    state=case when exists(select 1 from round_commands c where c.command_id=a.command_id and c.round_id=a.round_id and c.type='check_in'
      and c.payload_digest=a.payload_digest and c.actor_id is not distinct from a.actor_id and c.service_id is not distinct from a.service_id)
      then 'committed' else 'aborted' end,resolved_at=statement_timestamp()
    where a.state='pending' and a.attempt_id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}) returning a.attempt_id`);
  return rows.length;
}
