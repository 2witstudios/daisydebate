import type { SQL } from 'bun';

/**
 * Test-only (ADR 0075): removes queued owner digests nobody is owed any
 * more, once a suite deleted the pending accounts that joined in their
 * window. A digest belongs to a window, not to an account, so deleting the
 * accounts cannot cascade to it; the worker would cancel it as `not-owed`,
 * and this is that same rule applied at cleanup. A database migrated
 * before the queue existed has nothing to remove.
 */
export async function removeUnowedBetaDigests(sql: SQL): Promise<void> {
  // Migration suites run fixtures on databases migrated only part way.
  const [present] =
    (await sql`select to_regclass('public.mail_intents') is not null as present`) as {
      present: boolean;
    }[];
  if (!present?.present) return;
  await sql`delete from mail_intents m
    where m.purpose = 'beta-requests-digest' and m.state = 'queued'
      and not exists (select 1 from account_beta_access b
        where b.state = 'pending'
          and b.requested_at >= m.window_start
          and b.requested_at < m.window_start + interval '10 minutes')`;
}

/**
 * Test-only (ADR 0075): approves an account that claimed a username, as an
 * operator would, and gives it an adult age record if it has none, so
 * fixtures that need a participant get one. Idempotent; the
 * audit records it as a migration-style test principal. Never call this
 * from production code: approval belongs to the signed operator API.
 */
export async function approveBetaAccess(
  sql: SQL,
  userId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`insert into account_beta_access (user_id, state, revision, requested_at, decided_at, provenance)
      values (${userId}, 'approved', 1, now(), now(), 'signup')
      on conflict (user_id) do update set state = 'approved', revision = account_beta_access.revision + 1,
        decided_at = now()
      where account_beta_access.state <> 'approved'`;
    // Participant access also needs a durable age record at the floor (16+).
    await tx`insert into account_age (user_id, birth_month, version, recorded_at)
      values (${userId}, '2000-01', 1, now()) on conflict (user_id) do nothing`;
    await tx`update users set version = version + 1 where id = ${userId}`;
  });
}
