import { sql } from 'drizzle-orm';
import type { AdminExecutor } from './client';

/**
 * The admin app serves only as `daisy_admin_app` (ADR 0077): a role that
 * could create or alter schema objects, or own the tables (and so rewrite
 * the audit chain), is refused at startup. The catalog is read for
 * `current_user`; membership counts as ownership.
 */
export async function schemaPowers(db: AdminExecutor): Promise<string[]> {
  const rows = (await db.execute(sql`
    select array_remove(array[
      case when r.rolsuper then 'is a superuser' end,
      case when has_schema_privilege('public', 'CREATE')
        then 'can create in schema public' end,
      case when has_database_privilege(current_database(), 'CREATE')
        then 'can create schemas' end,
      case when exists (
        select from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'drizzle')
          and pg_has_role(c.relowner, 'MEMBER')
      ) then 'owns admin tables' end
    ], null) as powers
    from pg_roles r where r.rolname = current_user
  `)) as unknown as { powers: string[] }[];
  return rows[0]?.powers ?? ['is not a known role'];
}

/** Production refuses any schema power; development runs as the owner. */
export const roleRefusal = (
  nodeEnv: string,
  powers: readonly string[],
): string | null =>
  nodeEnv === 'production' && powers.length > 0
    ? `The admin app refuses an ADMIN_DATABASE_URL role that ${powers.join(', ')}; use daisy_admin_app`
    : null;
