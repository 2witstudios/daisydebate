import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';

const epoch = z.number().int().positive().max(2147483647);
const scope = { roundId: idSchema, sessionId: idSchema, workerId: idSchema };
const leaseRequestSchema = z.strictObject({
  ...scope,
  leaseMs: z.number().int().min(1000).max(30000),
  expectedEpoch: epoch.optional(),
});
const identitySchema = z.strictObject({ ...scope, epoch });
const leaseCheckSchema = identitySchema.safeExtend({ segmentId: idSchema });
export type BotListenerIdentity = z.infer<typeof identitySchema>;

const parse = <T>(schema: z.ZodType<T>, raw: unknown) => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw createAppError('VALIDATION');
  return parsed.data;
};
const iso = (column: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );
const stale = () => createAppError('CONFLICT', 'Bot listener lease is stale');

type CurrentLease = {
  readonly workerId: string;
  readonly epoch: number;
  readonly live: boolean;
};
/** Another live worker holds it, or a renewal no longer matches this worker's live epoch. */
function requireClaimable(
  current: CurrentLease | undefined,
  input: z.infer<typeof leaseRequestSchema>,
) {
  const mine = current?.workerId === input.workerId;
  if (current?.live && !mine)
    throw createAppError('CONFLICT', 'Bot listener lease is held');
  const renewal = input.expectedEpoch !== undefined;
  if (
    renewal &&
    !(current?.live && mine && current.epoch === input.expectedEpoch)
  )
    throw stale();
}
/** A first claim takes epoch 1, a live lease keeps its epoch, an expired one moves on. */
function nextEpoch(current: CurrentLease | undefined) {
  const next = !current ? 1 : current.live ? current.epoch : current.epoch + 1;
  if (next > 2147483647)
    throw createAppError('CONFLICT', 'Bot listener epoch exhausted');
  return next;
}

/** The session must be this Round's, live, and its Round still playing. */
async function requireLiveSession(
  tx: BoundedTransactionContext,
  input: { readonly roundId: string; readonly sessionId: string },
) {
  const [row] = (await tx.execute(sql`select 1 as live
    from media_sessions s join rounds r on r.id=s.round_id
    where s.id=${input.sessionId} and s.round_id=${input.roundId}
      and s.ended_at is null and s.unsafe_at is null
      and s.deletion_requested_at is null
      and r.status in ('scheduled','active')`)) as unknown as {
    live: number;
  }[];
  if (!row) throw createAppError('CONFLICT', 'Bot listener session is closed');
}

/** This worker's current epoch on a live session; returns fresh PostgreSQL time. */
async function requireCurrentLease(
  tx: BoundedTransactionContext,
  input: BotListenerIdentity,
) {
  const [row] =
    (await tx.execute(sql`select ${iso('clock_timestamp()')} as "serverNow"
    from bot_listener_leases l
    join media_sessions s on s.id=l.session_id
    where l.session_id=${input.sessionId} and s.round_id=${input.roundId}
      and l.worker_id=${input.workerId} and l.epoch=${input.epoch}
      and l.expires_at>clock_timestamp()
      and s.ended_at is null and s.unsafe_at is null
      and s.deletion_requested_at is null`)) as unknown as {
      serverNow: string;
    }[];
  if (!row) throw stale();
  return row.serverNow;
}

/**
 * The bot listener's own lease and reads (ISSUE-764): admitted only by
 * `bot_listener_leases`, never by the capture lease. Nothing here reads or
 * writes capture state.
 */
export const botListenerOperations = (transaction: BoundedTransaction) => ({
  /** Claims or renews the session's listener lease, like any media worker lease. */
  claimBotListenerLease(raw: unknown) {
    const input = parse(leaseRequestSchema, raw);
    return transaction(async (tx) => {
      await requireLiveSession(tx, input);
      const [current] = (await tx.execute(sql`select worker_id as "workerId",
        epoch, expires_at > clock_timestamp() as live
        from bot_listener_leases where session_id=${input.sessionId}
        for update`)) as unknown as CurrentLease[];
      requireClaimable(current, input);
      const next = nextEpoch(current);
      const [row] = (await tx.execute(sql`insert into bot_listener_leases
          (session_id, worker_id, epoch, expires_at)
        values (${input.sessionId}, ${input.workerId}, ${next},
          clock_timestamp() + ${input.leaseMs} * interval '1 millisecond')
        on conflict (session_id) do update set worker_id=excluded.worker_id,
          epoch=excluded.epoch, expires_at=excluded.expires_at
        returning epoch, ${iso('expires_at')} as "expiresAt"`)) as unknown as {
        epoch: number;
        expiresAt: string;
      }[];
      return row!;
    });
  },
  /**
   * What the listener needs to know under its current lease: the open
   * segment, the non-judge seats with their bound media identities, and
   * fresh PostgreSQL time for its clock calibration.
   */
  readBotListenerState(raw: unknown) {
    const input = parse(identitySchema, raw);
    return transaction(async (tx) => {
      const serverNow = await requireCurrentLease(tx, input);
      const [segment] = (await tx.execute(sql`select id, type,
          ${iso('ended_at')} as "endedAt"
        from round_segments where round_id=${input.roundId} and ended_at is null
        order by sequence desc limit 1`)) as unknown as {
        id: string;
        type: string;
        endedAt: string | null;
      }[];
      const participants = (await tx.execute(sql`select
          p.id as "roundParticipantId", a.kind, m.identity
        from round_participants p
        join actors a on a.id=p.actor_id
        left join media_participants m
          on m.round_participant_id=p.id and m.session_id=${input.sessionId}
        where p.round_id=${input.roundId} and p.role<>'judge'
        order by p.id`)) as unknown as {
        roundParticipantId: string;
        kind: string;
        identity: string | null;
      }[];
      return {
        roundId: input.roundId,
        sessionId: input.sessionId,
        serverNow,
        segment: segment ?? null,
        participants: [...participants],
      };
    });
  },
  /**
   * The per-batch check: this worker's epoch, an unexpired lease, a session
   * not ended, unsafe or being deleted, and the batch's segment still open.
   */
  readCurrentBotListenerLease(raw: unknown) {
    const input = parse(leaseCheckSchema, raw);
    return transaction(async (tx) => {
      const serverNow = await requireCurrentLease(tx, input);
      const [open] = (await tx.execute(sql`select 1 as open from round_segments
        where id=${input.segmentId} and round_id=${input.roundId}
          and ended_at is null`)) as unknown as { open: number }[];
      if (!open) throw stale();
      return { serverNow };
    });
  },
});
