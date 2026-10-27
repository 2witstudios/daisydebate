import { SQL } from 'bun';
import { migrateAdminDatabase } from '../../src/db/migrate';

/**
 * Before the browser suite's server starts: migrate the e2e admin database
 * as its owner, empty it, and provision the DML-only login the server runs
 * as (a member of daisy_admin_app, so it holds production's grants exactly).
 * Loopback only, and only a database whose name ends in `_admin_e2e`.
 */
const owner = process.env.E2E_ADMIN_DATABASE_URL ?? '';
const url = URL.canParse(owner) ? new URL(owner) : null;
if (
  !url ||
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  !url.pathname.endsWith('_admin_e2e')
)
  throw new Error(
    'E2E_ADMIN_DATABASE_URL must name a loopback database ending in _admin_e2e',
  );
await migrateAdminDatabase(owner);
const sql = new SQL(owner, { max: 1 });
try {
  await sql.unsafe(`
    truncate audit_events, chain_checkpoints, auth_attempts, pending_commands, operator_sessions,
      operator_challenges, operator_credentials, operator_enrollments, operators;
    do $$ begin
      if not exists (select from pg_roles where rolname = 'daisy_admin_e2e') then
        create role daisy_admin_e2e login password 'admin-e2e-loopback-only';
      end if;
    end $$;
    grant daisy_admin_app to daisy_admin_e2e;
  `);
} finally {
  await sql.close();
}
