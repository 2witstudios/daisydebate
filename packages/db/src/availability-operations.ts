import type { SQL, ReservedSQL } from 'bun';
import { createAppError } from '@daisy/errors';
import { availabilityRecoveryPolicy, idSchema } from '@daisy/protocol';
import {
  decodeOutboxCursor,
  encodeOutboxCursor,
  type OutboxPosition,
} from './outbox';

const SAMPLER_LOCK = 59003;
export type AvailabilityCause =
  | 'web_stale'
  | 'realtime_stale'
  | 'delivery_lag'
  | 'public_probe_failed'
  | 'check_in_pending';
export type AvailabilityEvidence = {
  readonly at: string;
  readonly healthy: boolean;
  readonly cause: AvailabilityCause | null;
};
type ProbeEvidence = {
  readonly publicProbeHealthy: boolean;
};

/** One session owns election AND insertion. Closing it releases election on process death. */
export function createAvailabilitySampler(client: SQL) {
  let session: ReservedSQL | null = null;
  let running = false;
  let stopped = false;
  const electSession = async () => {
    session ??= await client.reserve({ signal: AbortSignal.timeout(900) });
    const [election] =
      await session`select case when exists(select 1 from pg_locks
        where locktype='advisory' and pid=pg_backend_pid() and classid=0
          and objid=${SAMPLER_LOCK}::oid and objsubid=1 and granted)
        then true else pg_try_advisory_lock(${SAMPLER_LOCK}::bigint) end as elected`;
    return election.elected === true;
  };
  return {
    /** Election is evidence from the SAME reserved producer session, never a process flag. */
    async elect(): Promise<boolean> {
      if (stopped || running) return false;
      running = true;
      try {
        return await electSession();
      } catch (error) {
        throw createAppError(
          'INFRASTRUCTURE',
          'Availability election unavailable',
          error,
        );
      } finally {
        running = false;
      }
    },
    async sample(
      evidence: ProbeEvidence,
    ): Promise<AvailabilityEvidence | null> {
      if (stopped || running) return null;
      running = true;
      try {
        if (!(await electSession()) || !session) return null;
        const [row] = await session`
          with instant as (select statement_timestamp() as at),
          facts as (
            select at,
              exists(select 1 from service_instances where role='web' and renewed_at > at-interval '3 seconds') as web,
              exists(select 1 from service_instances where role='realtime' and renewed_at > at-interval '3 seconds') as realtime,
              exists(select 1 from service_instances s where role='realtime' and renewed_at > at-interval '3 seconds'
                and not exists(select 1 from outbox o where o.created_at < at-interval '2 seconds'
                  and (o.txid,o.seq) > (s.delivered_through_txid,s.delivered_through))) as delivered
            from instant
          ), assessment as (
            select at,case when exists(select 1 from round_check_in_attempts where state='pending') then 'check_in_pending' when not web then 'web_stale' when not realtime then 'realtime_stale'
              when not delivered then 'delivery_lag' when not ${evidence.publicProbeHealthy} then 'public_probe_failed' else null end as cause from facts
          )
          insert into availability_samples(at,healthy,cause)
          select at,cause is null,cause from assessment
          where at > coalesce((select max(at) from availability_samples),'-infinity'::timestamptz)
            and exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid()
              and classid=0 and objid=${SAMPLER_LOCK}::oid and objsubid=1 and granted)
          returning to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,healthy,cause`;
        return row
          ? {
              at: row.at,
              healthy: row.healthy,
              cause: row.cause,
            }
          : null;
      } catch (error) {
        throw createAppError(
          'INFRASTRUCTURE',
          'Availability sampling unavailable',
          error,
        );
      } finally {
        running = false;
      }
    },
    async close() {
      stopped = true;
      if (running) throw createAppError('CONFLICT', 'Sampler is still running');
      const held = session;
      session = null;
      if (held) {
        try {
          await held`select pg_advisory_unlock(${SAMPLER_LOCK}::bigint)`;
        } finally {
          held.release();
        }
      }
    },
  };
}

/**
 * The samples a decision about anything opened at or after `from` needs
 * (ISSUE-529): the latest recovery samples before `from`, which fix the
 * outage state it opens into, then every sample since. Fewer earlier
 * samples read them all, so a missing prefix still leaves the speech
 * undetermined. Takes either client's tagged template (Bun SQL or Drizzle).
 */
export const availabilitySamplesFrom = <T>(
  query: (strings: TemplateStringsArray, ...values: unknown[]) => T,
  from: string,
): T =>
  query`select to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,healthy,cause from availability_samples
    where at >= coalesce((select at from availability_samples where at < ${from}::timestamptz order by at desc offset ${availabilityRecoveryPolicy.recoverySamples - 1} limit 1),'-infinity'::timestamptz)
    order by at`;

export function availabilityOperations(client: SQL) {
  return {
    async renewServiceInstance(
      input: { readonly instanceId: string } & (
        | { readonly role: 'web' }
        | {
            readonly role: 'realtime';
            readonly deliveredThrough: OutboxPosition;
          }
      ),
    ) {
      if (!idSchema.safeParse(input.instanceId).success)
        throw createAppError('VALIDATION');
      const cursor =
        input.role === 'realtime'
          ? decodeOutboxCursor(encodeOutboxCursor(input.deliveredThrough))
          : null;
      await client`insert into service_instances(instance_id,role,renewed_at,delivered_through,delivered_through_txid)
        values(${input.instanceId},${input.role},statement_timestamp(),${cursor?.seq.toString() ?? null}::bigint,${cursor?.txid ?? null}::xid8)
        on conflict(instance_id) do update set renewed_at=excluded.renewed_at,
          delivered_through=excluded.delivered_through,delivered_through_txid=excluded.delivered_through_txid
        where service_instances.role=excluded.role`;
    },
    availabilitySampler: () => createAvailabilitySampler(client),
    async readAvailabilitySamples(
      from: string,
    ): Promise<readonly AvailabilityEvidence[]> {
      if (!Number.isFinite(Date.parse(from)))
        throw createAppError('VALIDATION');
      const rows: {
        at: string;
        healthy: boolean;
        cause: AvailabilityCause | null;
      }[] = await availabilitySamplesFrom(
        (strings, ...values) => client(strings, ...values),
        from,
      );
      return rows.map((row) => ({
        at: row.at,
        healthy: row.healthy,
        cause: row.cause,
      }));
    },
    async purgeExpiredServiceInstances(input: {
      readonly before: string;
      readonly limit: number;
    }) {
      requireRetentionBounds(input);
      const rows =
        await client`delete from service_instances where instance_id in
        (select instance_id from service_instances where renewed_at < ${input.before}::timestamptz order by renewed_at limit ${input.limit}) returning instance_id`;
      return rows.length;
    },
    async purgeExpiredAvailabilitySamples(input: {
      readonly before: string;
      readonly limit: number;
    }) {
      requireRetentionBounds(input);
      const rows = await client`delete from availability_samples where at in
        (select at from availability_samples where at < ${input.before}::timestamptz order by at limit ${input.limit}) returning at`;
      return rows.length;
    },
  };
}

/** A retention purge needs a parseable horizon and a 1–1000 batch. */
export function requireRetentionBounds(input: {
  readonly before: string;
  readonly limit: number;
}): void {
  if (
    !Number.isFinite(Date.parse(input.before)) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 1000
  )
    throw createAppError('VALIDATION');
}
