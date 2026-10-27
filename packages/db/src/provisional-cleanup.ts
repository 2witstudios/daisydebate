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

/** A purpose's identifier prefix as a LIKE pattern, its wildcards escaped. */
export const purposePattern = (purpose: string): string =>
  `${purpose.replace(/[\\%_]/g, '\\$&')}:%`;

/** Matches one purpose's rows through the identifier index (ISSUE-716). */
const startsWithPurpose = (purpose: string) =>
  sql`${verifications.identifier} like ${purposePattern(purpose)}`;

/** The link purposes a provisional account's emailed links are stored under. */
export type ProvisionalLinkPurposes = Pick<
  ProvisionalMailCleanup,
  'signInPurpose' | 'emailChangePurposes'
>;

/**
 * Deletes the account's own emailed links: sign-in links to its email and
 * email-change links naming its id. Caller holds the user row lock and has
 * freshly established provisional authority.
 */
export async function clearProvisionalLinks(
  tx: Transaction,
  user: { readonly id: string; readonly email: string | null },
  input: ProvisionalLinkPurposes,
): Promise<void> {
  await tx.delete(verifications).where(sql`case
    when ${startsWithPurpose(input.signInPurpose)}
      then lower(${verifications.value}::jsonb ->> 'email') = lower(${user.email})
    when ${input.emailChangePurposes.length === 0 ? sql`false` : sql.join(input.emailChangePurposes.map(startsWithPurpose), sql` or `)}
      then ${verifications.value}::jsonb ->> 'userId' = ${user.id}
    else false end`);
}

/**
 * The under-age deletion's cleanup (WAIT-4.7, DEC-244: nothing kept): its
 * links and its delivery receipts. The abandoned-account sweep clears links
 * only, so a late bounce or complaint still finds its receipt and suppresses
 * the address (ADR 0025).
 */
export async function clearProvisionalMail(
  tx: Transaction,
  user: { readonly id: string; readonly email: string | null },
  input: ProvisionalMailCleanup,
): Promise<void> {
  await clearProvisionalLinks(tx, user, input);
  if (user.email !== null)
    await tx
      .delete(emailDeliveries)
      .where(
        eq(emailDeliveries.recipientHash, input.recipientHashOf(user.email)),
      );
}
