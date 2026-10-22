import { SQL } from 'bun';
import { createAppError } from '@daisy/errors';
import { RUNTIME_SESSION } from './session-bounds';

/**
 * The capture worker's only database reader, run under `daisy_media_worker`.
 * Discovery is advisory: the signed web path claims the lease under the
 * Round and lease locks, and refuses anything this scan saw stale.
 */
export function createMediaWorkerDatabase(input: {
  url: string;
  /** Overrides dialing `url`; tests inject a role-scoped client. */
  client?: SQL;
}) {
  const client =
    input.client ??
    new SQL(input.url, {
      max: 2,
      connectionTimeout: 3,
      idleTimeout: 20,
      connection: RUNTIME_SESSION,
    });
  return {
    async discoverCaptureSessions(limit: number) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
        throw createAppError('VALIDATION');
      const rows: { round_id: string; session_id: string }[] = await client`
        select s.round_id, s.id as session_id
        from media_sessions s
        join rounds r on r.id = s.round_id
        left join media_worker_leases l on l.session_id = s.id
        where s.ended_at is null and s.unsafe_at is null
          and s.deletion_requested_at is null
          and r.status in ('scheduled', 'active')
          and (l.session_id is null or l.expires_at <= clock_timestamp())
        order by s.created_at, s.id
        limit ${limit}`;
      return rows.map((row) => ({
        roundId: row.round_id,
        sessionId: row.session_id,
      }));
    },
    /** Startup refuses any login broader than `daisy_media_worker`. */
    async privilegeProblems() {
      const [facts]: {
        superuser: boolean;
        member: boolean;
        writes: boolean;
      }[] = await client`
        select r.rolsuper as superuser,
          pg_has_role(current_user, 'daisy_media_worker', 'usage') as member,
          (select bool_or(has_table_privilege(c.oid, p.privilege))
            from pg_class c
            cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p(privilege)
            where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          ) as writes
        from pg_roles r where r.rolname = current_user`;
      return [
        ...(facts?.superuser ? ['superuser'] : []),
        ...(facts?.member ? [] : ['not a capture worker']),
        ...(facts?.writes === false ? [] : ['writes']),
      ];
    },
    close: () => client.close(),
  };
}
