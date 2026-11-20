import { sql } from 'drizzle-orm';
import { normalizeEmail } from '@daisy/protocol/email';
import { lockPreapprovalEmail } from './beta-preapproval-claim';
import type { Tx } from './tx';
import { run, query } from './raw-rows';
import { z } from 'zod';

/** Caller holds the account fence. Order: sorted emails, grants, then mail. */
export async function eraseBetaPreapprovals(
  tx: Tx,
  userId: string,
): Promise<void> {
  const [user] = await query(
    tx,
    z.object({ email: z.string().nullable() }),
    sql`select email from users where id = ${userId}`,
  );
  const email = user?.email ? normalizeEmail(user.email) : null;
  const owned = await query(
    tx,
    z.object({ email: z.string() }),
    sql`select email from beta_preapprovals where claimed_user_id = ${userId}`,
  );
  const emails = [
    ...new Set([...owned.map((row) => row.email), ...(email ? [email] : [])]),
  ].sort();
  for (const address of emails) await lockPreapprovalEmail(tx, address);
  const grants = await query(
    tx,
    z.object({ id: z.string() }),
    sql`select id from beta_preapprovals where claimed_user_id = ${userId} or (claimed_user_id is null and email = ${email}) order by email for update`,
  );
  for (const grant of grants) {
    await run(
      tx,
      sql`delete from mail_intents where preapproval_id = ${grant.id}`,
    );
    await run(tx, sql`delete from beta_preapprovals where id = ${grant.id}`);
  }
}
