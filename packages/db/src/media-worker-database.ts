import { SQL } from 'bun';
import { createAppError } from '@daisy/errors';
import { RUNTIME_SESSION } from './session-bounds';

/** The only relations `daisy_media_worker` is granted SELECT on. */
const CAPTURE_TABLES = [
  'rounds',
  'round_participants',
  'round_segments',
  'media_sessions',
  'media_participants',
  'media_worker_leases',
];

/** Each login fact that makes it broader than the worker role, in report order. */
const PRIVILEGE_PROBLEMS = {
  superuser: 'superuser',
  createrole: 'createrole',
  createdb: 'createdb',
  bypassrls: 'bypassrls',
  replication: 'replication',
  outsider: 'not a capture worker',
  writes: 'writes',
  creates: 'creates',
  reads: 'reads',
  others: 'other roles',
} as const;

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
      const [facts]: Partial<
        Record<keyof typeof PRIVILEGE_PROBLEMS, boolean | null>
      >[] = await client`
        select r.rolsuper as superuser, r.rolcreaterole as createrole,
          r.rolcreatedb as createdb, r.rolbypassrls as bypassrls,
          r.rolreplication as replication,
          not pg_has_role(current_user, 'daisy_media_worker', 'usage') as outsider,
          exists (select 1 from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname <> 'information_schema'
              and left(n.nspname, 3) <> 'pg_'
              and ((c.relkind in ('r', 'p', 'v', 'f')
                  and (has_any_column_privilege(c.oid, 'INSERT')
                    or has_any_column_privilege(c.oid, 'UPDATE')
                    or has_table_privilege(c.oid, 'DELETE')
                    or has_table_privilege(c.oid, 'TRUNCATE')))
                or (c.relkind = 'S' and has_sequence_privilege(c.oid, 'UPDATE')))
          ) as writes,
          has_database_privilege(current_database(), 'CREATE')
            or exists (select 1 from pg_namespace n
              where n.nspname <> 'information_schema'
                and left(n.nspname, 3) <> 'pg_'
                and has_schema_privilege(n.oid, 'CREATE')
            ) as creates,
          exists (select 1 from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r', 'p', 'v', 'm', 'f')
              and n.nspname <> 'information_schema'
              and left(n.nspname, 3) <> 'pg_'
              and not (n.nspname = 'public' and c.relname in ${client(CAPTURE_TABLES)})
              and has_any_column_privilege(c.oid, 'SELECT')
          ) as reads,
          exists (select 1 from pg_roles o
            where o.rolname not in (current_user, 'daisy_media_worker')
              and pg_has_role(current_user, o.oid, 'member')
          ) as others
        from pg_roles r where r.rolname = current_user`;
      // A missing or unknown fact is a problem: startup fails closed.
      return Object.entries(PRIVILEGE_PROBLEMS).flatMap(([fact, problem]) =>
        facts?.[fact as keyof typeof PRIVILEGE_PROBLEMS] === false
          ? []
          : [problem],
      );
    },
    close: () => client.close(),
  };
}
