import { eraseBetaPreapprovals } from './beta-preapproval-erasure';
import { normalizedEmailSql } from './email-identity';
import { sql } from 'drizzle-orm';
import { exportRows } from './privacy/export-rows';
import type { PrivacyAdopter } from './privacy/contracts';

/**
 * Erasure deletes the subject's beta state and any mail still owed to them
 * (ADR 0075): a closed account has no beta state, and an approval email is
 * never sent to it. The access events and operator receipts stay as
 * operational audit against the closed account. Export returns the
 * subject's own access row.
 */
export const betaAccessPrivacyAdopter: PrivacyAdopter = {
  id: 'beta-access',
  phase: 'before-auth',
  erase: async (tx, subject) => {
    await eraseBetaPreapprovals(tx, subject.userId);
    await tx.execute(
      sql`delete from mail_intents where recipient_user_id = ${subject.userId}`,
    );
    await tx.execute(
      sql`delete from account_beta_access where user_id = ${subject.userId}`,
    );
  },
  export: async (tx, subject) => {
    const rows = (await tx.execute(sql`select user_id, state, revision,
        to_char(requested_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as requested_at,
        to_char(decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as decided_at,
        provenance
      from account_beta_access where user_id = ${subject.userId}`)) as unknown as Record<
      string,
      unknown
    >[];
    const preapprovals = (await tx.execute(
      sql`select id, email, created_at, claimed_at from beta_preapprovals where claimed_by = ${subject.userId} or (claimed_by is null and email = (select ${normalizedEmailSql(sql`email`)} from users where id = ${subject.userId}))`,
    )) as unknown as Record<string, unknown>[];
    return {
      account_beta_access: rows,
      beta_preapprovals: exportRows(preapprovals),
    };
  },
};
