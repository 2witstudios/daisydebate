import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { verifications } from './schema/auth';
import { emailDeliveries } from './schema/email-delivery';

type Transaction = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];
export type ProvisionalMailCleanup = {
  readonly signInPurpose: string;
  readonly recipientHashOf: (email: string) => string;
};

/** Caller holds the user row lock and has freshly established provisional authority. */
export async function clearProvisionalMail(
  tx: Transaction,
  user: { readonly id: string; readonly email: string | null },
  input: ProvisionalMailCleanup,
): Promise<void> {
  await tx.delete(verifications).where(sql`case
    when starts_with(${verifications.identifier}, ${`${input.signInPurpose}:`})
      then lower(${verifications.value}::jsonb ->> 'email') = lower(${user.email})
    when starts_with(${verifications.identifier}, 'email-change-approve:')
      or starts_with(${verifications.identifier}, 'email-change-verify:')
      then ${verifications.value}::jsonb ->> 'userId' = ${user.id}
    else false end`);
  if (user.email !== null)
    await tx
      .delete(emailDeliveries)
      .where(
        eq(emailDeliveries.recipientHash, input.recipientHashOf(user.email)),
      );
}
