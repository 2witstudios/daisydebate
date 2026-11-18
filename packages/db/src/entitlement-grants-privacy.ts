import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';

/** Erasure deletes the subject's grants; export returns them. */
export const entitlementGrantPrivacyAdopter: PrivacyAdopter = {
  id: 'entitlement-grants',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from account_entitlement_grants where user_id = ${subject.userId}`,
    );
    await tx.execute(
      sql`select public.daisy_erase_unused_hosting_versions(${subject.userId})`,
    );
  },
  export: async (tx, subject) => {
    const rows = (await tx.execute(sql`select entitlement, source,
        to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as starts_at,
        to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        hosting_version_id, to_char(revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as revoked_at
      from account_entitlement_grants where user_id = ${subject.userId}
      order by entitlement, source`)) as unknown as Record<string, unknown>[];
    const hostingVersions = await tx.execute(sql`select id,source,version,
      to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as starts_at,
      to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at,
      issuer_service_id,issuer_operator_ref,decision_reference,subscription_id,
      to_char(subscription_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as subscription_observed_at,
      subscription_evidence,coverage from account_hosting_versions where user_id=${subject.userId} order by source,version`);
    return {
      account_entitlement_grants: rows.map(
        ({ hosting_version_id, revoked_at, ...row }) =>
          row.entitlement === 'tournament_hosting'
            ? { ...row, hosting_version_id, revoked_at }
            : row,
      ),
      account_hosting_versions: hostingVersions as unknown as Record<
        string,
        unknown
      >[],
    };
  },
};
