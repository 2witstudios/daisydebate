import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { normalizeEmail } from '@daisy/protocol/email';
import { lockPreapprovalEmail } from './beta-preapproval-claim';

type Tx = Pick<BunSQLDatabase, 'execute'>;

/** Caller holds the account fence. Order: sorted emails, grants, then mail. */
export async function eraseBetaPreapprovals(
  tx: Tx,
  userId: string,
): Promise<void> {
  const [user] = (await tx.execute(
    sql`select email from users where id = ${userId}`,
  )) as unknown as { email: string | null }[];
  const email = user?.email ? normalizeEmail(user.email) : null;
  const owned = (await tx.execute(
    sql`select email from beta_preapprovals where claimed_user_id = ${userId}`,
  )) as unknown as { email: string }[];
  const emails = [
    ...new Set([...owned.map((row) => row.email), ...(email ? [email] : [])]),
  ].sort();
  for (const address of emails) await lockPreapprovalEmail(tx, address);
  const grants = (await tx.execute(
    sql`select id from beta_preapprovals where claimed_user_id = ${userId} or (claimed_user_id is null and email = ${email}) order by email for update`,
  )) as unknown as { id: string }[];
  for (const grant of grants) {
    await tx.execute(
      sql`delete from mail_intents where preapproval_id = ${grant.id}`,
    );
    await tx.execute(sql`delete from beta_preapprovals where id = ${grant.id}`);
  }
}
