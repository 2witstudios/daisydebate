import { betaAccessStates } from '@daisy/protocol/beta-access';
import { eraseBetaPreapprovals } from './beta-preapproval-erasure';
import { normalizedEmailSql } from './email-identity';
import { sql } from 'drizzle-orm';
import { exportRows, run, query } from './raw-rows';
import type { PrivacyAdopter } from './privacy/contracts';
import { z } from 'zod';

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
    await run(
      tx,
      sql`delete from mail_intents where recipient_user_id = ${subject.userId}`,
    );
    await run(
      tx,
      sql`delete from account_beta_access where user_id = ${subject.userId}`,
    );
  },
  export: async (tx, subject) => {
    const rows = await query(
      tx,
      z.object({
        user_id: z.string(),
        state: z.enum(betaAccessStates),
        revision: z.int(),
        requested_at: z.string(),
        decided_at: z.string().nullable(),
        provenance: z.string(),
      }),
      sql`select user_id, state, revision,
        to_char(requested_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as requested_at,
        to_char(decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as decided_at,
        provenance
      from account_beta_access where user_id = ${subject.userId}`,
    );
    const preapprovals = await query(
      tx,
      z.object({
        id: z.string(),
        email: z.string(),
        created_at: z.date(),
        claimed_at: z.date().nullable(),
      }),
      sql`select id, email, created_at, claimed_at from beta_preapprovals where claimed_user_id = ${subject.userId} or (claimed_user_id is null and email = (select ${normalizedEmailSql(sql`email`)} from users where id = ${subject.userId}))`,
    );
    return {
      account_beta_access: rows,
      beta_preapprovals: exportRows(preapprovals),
    };
  },
};
