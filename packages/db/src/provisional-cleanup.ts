import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { verifications } from './schema/auth';
import { emailDeliveries } from './schema/email-delivery';

type Transaction = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];
/**
 * The app's emailed-link purposes and keyed recipient hash: @daisy/db holds
 * neither the purpose names nor the key, so a renamed purpose cannot
 * silently stop the cleanup matching.
 */
export type ProvisionalMailCleanup = {
  /** Sign-in links, whose subject is the account's email. */
  readonly signInPurpose: string;
  /** Email-change links, whose subject is the account's id. */
  readonly emailChangePurposes: readonly string[];
  readonly recipientHashOf: (email: string) => string;
};

const startsWithPurpose = (purpose: string) =>
  sql`starts_with(${verifications.identifier}, ${`${purpose}:`})`;

/** Caller holds the user row lock and has freshly established provisional authority. */
export async function clearProvisionalMail(
  tx: Transaction,
  user: { readonly id: string; readonly email: string | null },
  input: ProvisionalMailCleanup,
): Promise<void> {
  await tx.delete(verifications).where(sql`case
    when ${startsWithPurpose(input.signInPurpose)}
      then lower(${verifications.value}::jsonb ->> 'email') = lower(${user.email})
    when ${input.emailChangePurposes.length === 0 ? sql`false` : sql.join(input.emailChangePurposes.map(startsWithPurpose), sql` or `)}
      then ${verifications.value}::jsonb ->> 'userId' = ${user.id}
    else false end`);
  if (user.email !== null)
    await tx
      .delete(emailDeliveries)
      .where(
        eq(emailDeliveries.recipientHash, input.recipientHashOf(user.email)),
      );
}
