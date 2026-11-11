import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { decideBetaAccessChange } from '@daisy/protocol';
import { normalizeEmail } from '@daisy/protocol/email';
import { canClaimPreapproval } from '@daisy/protocol/beta-preapproval';
import { loadAuthorizationAccount } from './authorization';
import { writeBetaAccessChange } from './beta-access-change';
import { mailIntentQueue } from './mail-intent-queue';

type Tx = Pick<BunSQLDatabase, 'execute'>;

/** Account fence first, then email fence, including absent grants. */
export const lockPreapprovalEmail = (tx: Tx, email: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${normalizeEmail(email)}, 59080))`,
  );

/**
 * A claim is the one beta access transition, decided on the fresh fact. Its
 * caller has already admitted the age (`canClaimPreapproval`).
 */
const claimedAccess = (
  beta: Parameters<typeof decideBetaAccessChange>[0]['current'],
) => {
  const decision = decideBetaAccessChange({
    current: beta,
    desired: 'approved',
    expectedRevision: beta?.revision ?? 0,
    ageAdmitted: true,
  });
  return decision.kind === 'changed' ? decision : null;
};

/** Caller holds the account fence. This never sends an approval email. */
export async function claimBetaPreapproval(
  tx: Tx,
  userId: string,
  audit: { readonly principal: string; readonly commandId: string | null } = {
    principal: 'signup',
    commandId: null,
  },
): Promise<boolean> {
  const [user] = (await tx.execute(
    sql`select email, email_verified from users where id = ${userId}`,
  )) as unknown as { email: string | null; email_verified: boolean }[];
  if (!user?.email) return false;
  const email = normalizeEmail(user.email);
  await lockPreapprovalEmail(tx, email);
  const fact = await loadAuthorizationAccount(tx, userId);
  if (
    !fact ||
    !canClaimPreapproval({
      verified: user.email_verified,
      erased: fact.erased,
      restricted: fact.restricted,
      state: fact.beta?.state ?? null,
      ageBand: fact.ageBand,
    })
  )
    return false;
  const change = claimedAccess(fact.beta);
  if (!change) return false;
  const [grant] = (await tx.execute(
    sql`update beta_preapprovals set claimed_user_id = ${userId}, claimed_at = now(), revision = revision + 1 where email = ${email} and claimed_user_id is null returning id`,
  )) as unknown as { id: string }[];
  if (!grant) return false;
  await writeBetaAccessChange(tx, {
    userId,
    change,
    eventId: grant.id,
    commandId: audit.commandId,
    principal: audit.principal,
  });
  return true;
}

/** Cancels a grant's invitations still owed. */
export const cancelPreapprovalInvitations = (tx: Tx, id: string) =>
  mailIntentQueue.cancelOwed(tx, sql`preapproval_id = ${id}`);
