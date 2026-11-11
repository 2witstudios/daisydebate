import { createAppError } from '@daisy/errors';
import type { BetaAccessDecision } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { applyBetaEntitlementGrants } from './entitlement-grants';
import { rowsOf } from './raw-rows';

/**
 * The one write of a decided beta access change (ADR 0075), under the
 * account fence its caller holds: the state and revision the decision names,
 * only from the state and revision it was decided on, then the entitlement
 * grants, the account fact's revision and the audit event of that same move.
 */
export async function writeBetaAccessChange(
  tx: Pick<BunSQLDatabase, 'execute'>,
  input: {
    readonly userId: string;
    readonly change: Extract<BetaAccessDecision, { kind: 'changed' }>;
    readonly eventId: string;
    readonly commandId: string | null;
    readonly principal: string;
  },
): Promise<void> {
  const { change, userId } = input;
  const moved = await rowsOf(
    tx,
    sql`update account_beta_access set state = ${change.to},
        revision = ${change.revision}, decided_at = now()
      where user_id = ${userId} and state = ${change.from}
        and revision = ${change.revision - 1}
      returning user_id`,
  );
  // The fence makes this unreachable; a change decided on another row writes nothing.
  if (moved.length !== 1) throw createAppError('CONFLICT');
  // Premium entitlements are their own fact, written with the state change.
  await applyBetaEntitlementGrants(tx, userId, change.to);
  // The account fact's revision moves, so live realtime sessions re-check.
  await tx.execute(
    sql`update users set version = version + 1 where id = ${userId}`,
  );
  await tx.execute(sql`insert into account_access_events
      (id, user_id, command_id, from_state, to_state, revision, principal)
    values (${input.eventId}, ${userId}, ${input.commandId},
      ${change.from}, ${change.to}, ${change.revision}, ${input.principal})`);
}
