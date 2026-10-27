import type { SQL } from 'bun';

/**
 * Test-only (ADR 0075): removes queued owner digests nobody is owed any
 * more, once a suite deleted the pending accounts that joined in their
 * window. A digest belongs to a window, not to an account, so deleting the
 * accounts cannot cascade to it; the worker would cancel it as `not-owed`,
 * and this is that same rule applied at cleanup.
 */
export async function removeUnowedBetaDigests(sql: SQL): Promise<void> {
  await sql`delete from mail_intents m
    where m.purpose = 'beta-requests-digest' and m.state = 'queued'
      and not exists (select 1 from account_beta_access b
        where b.state = 'pending'
          and b.requested_at >= (substr(m.dedupe_key, 15, 16) || ':00+00')::timestamptz
          and b.requested_at < (substr(m.dedupe_key, 15, 16) || ':00+00')::timestamptz + interval '10 minutes')`;
}
