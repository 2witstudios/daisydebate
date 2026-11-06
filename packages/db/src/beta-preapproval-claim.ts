import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { normalizeEmail } from '@daisy/protocol/email';
import { canClaimPreapproval } from '@daisy/protocol/beta-preapproval';
import { loadAuthorizationAccount } from './authorization';
import { applyBetaEntitlementGrants } from './entitlement-grants';

type Tx = Pick<BunSQLDatabase, 'execute'>;

/** Account fence first, then email fence, including absent grants. */
export const lockPreapprovalEmail = (tx: Tx, email: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${normalizeEmail(email)}, 59080))`,
  );

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
  const [grant] = (await tx.execute(
    sql`update beta_preapprovals set claimed_by = ${userId}, claimed_at = now(), revision = revision + 1 where email = ${email} and claimed_by is null returning id`,
  )) as unknown as { id: string }[];
  if (!grant) return false;
  await tx.execute(
    sql`update account_beta_access set state = 'approved', decided_at = now(), revision = revision + 1 where user_id = ${userId}`,
  );
  await applyBetaEntitlementGrants(tx, userId, 'approved');
  await tx.execute(
    sql`update users set version = version + 1 where id = ${userId}`,
  );
  await tx.execute(
    sql`insert into account_access_events (id, user_id, command_id, from_state, to_state, revision, principal) values (${grant.id}, ${userId}, ${audit.commandId}, 'pending', 'approved', ${fact.beta!.revision + 1}, ${audit.principal})`,
  );
  return true;
}

/** Cancels work still owed; a provider request already in flight cannot be recalled. */
export const cancelPreapprovalInvitations = (tx: Tx, id: string) =>
  tx.execute(
    sql`update mail_intents set state = 'cancelled', completed_at = now(), last_error_code = 'not-owed', lease_token_digest = null, lease_expires_at = null where preapproval_id = ${id} and state in ('queued', 'leased')`,
  );
