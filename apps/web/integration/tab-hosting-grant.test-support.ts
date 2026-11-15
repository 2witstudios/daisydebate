import type { TransactionSQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';

/** Explicit operator fixture only, never a production issuer or inferred Premium upgrade. */
export const seedHostingGrant = async (
  sql: TransactionSQL,
  userId: string,
  options: {
    readonly tournamentIds?: readonly string[];
    readonly issuerOperatorRef?: string;
    readonly validForMs?: number;
    readonly replaceCurrent?: boolean;
  } = {},
) => {
  const versionId = createId();
  const [principal] = await sql<
    { role: string }[]
  >`select current_user as role`;
  if (!principal) throw new Error('Test issuer role unavailable');
  await sql.savepoint(async (seed) => {
    await seed.unsafe('reset role');
    await seed`insert into account_hosting_versions
      (id,user_id,source,version,starts_at,expires_at,issuer_service_id,issuer_operator_ref,decision_reference,coverage)
      values (${versionId},${userId},'administrative',(select coalesce(max(version),0)+1 from account_hosting_versions where user_id=${userId} and source='administrative'),clock_timestamp()-interval '1 minute',
        clock_timestamp()+${options.validForMs ?? 86_400_000}*interval '1 millisecond','daisy-admin',${options.issuerOperatorRef ?? createId()},'DEC409 explicit test operator grant',
        ${{ tournamentIds: options.tournamentIds ?? [], sponsorConcurrencyLimit: 1, tournamentConcurrencyLimit: 1 }})`;
    if (options.replaceCurrent)
      await seed`delete from account_entitlement_grants where user_id=${userId} and entitlement='tournament_hosting' and source='administrative'`;
    await seed`insert into account_entitlement_grants (user_id,entitlement,source,hosting_version_id)
      values (${userId},'tournament_hosting','administrative',${versionId})`;
    await seed.unsafe(
      'set local role "' + principal.role.replaceAll('"', '""') + '"',
    );
  });
  return versionId;
};
