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
 * Test-only (ADR 0075): admits accounts as participants, the default every
 * integration fixture builds: an approved beta row and an adult age record
 * (kept if one exists; `recordedAt` pins a suite's clock). The account
 * revision is left alone for fresh fixture accounts; `approveBetaAccess`
 * moves it for an account a session already read. Gate and age suites opt
 * out by not calling it. Never call this from production code: approval
 * belongs to the signed operator API.
 */
export async function admitParticipants(
  sql: SQL,
  userIds: readonly string[],
  recordedAt?: string,
): Promise<void> {
  if (userIds.length === 0) return;
  const ids = `{${userIds.join(',')}}`;
  await sql`insert into account_beta_access (user_id, state, revision, requested_at, decided_at, provenance)
    select id, 'approved', 1, now(), now(), 'signup' from unnest(${ids}::text[]) as id
    on conflict (user_id) do update set state = 'approved', revision = account_beta_access.revision + 1,
      decided_at = now()
    where account_beta_access.state <> 'approved'`;
  await sql`insert into account_age (user_id, birth_month, version, recorded_at)
    select id, '2000-01', 1, coalesce(${recordedAt ?? null}::timestamptz, now())
    from unnest(${ids}::text[]) as id
    on conflict (user_id) do nothing`;
}

/**
 * Test-only (ADR 0075): approves an account that already claimed a
 * username, as an operator would, through `admitParticipants`, then moves
 * its account revision so a live session re-reads the fact. Idempotent.
 */
export async function approveBetaAccess(
  sql: SQL,
  userId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await admitParticipants(tx, [userId]);
    await tx`update users set version = version + 1 where id = ${userId}`;
  });
}
