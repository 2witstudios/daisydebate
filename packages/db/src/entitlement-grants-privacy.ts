import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { run, query } from './raw-rows';
import { z } from 'zod';

/** Erasure deletes the subject's grants; export returns them. */
export const entitlementGrantPrivacyAdopter: PrivacyAdopter = {
  id: 'entitlement-grants',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await run(
      tx,
      sql`delete from account_entitlement_grants where user_id = ${subject.userId}`,
    );
    await run(
      tx,
      sql`select public.daisy_erase_unused_hosting_versions(${subject.userId})`,
    );
  },
  export: async (tx, subject) => {
    const rows = await query(
      tx,
      z.object({
        entitlement: z.string(),
        source: z.string(),
        starts_at: z.string().nullable(),
        expires_at: z.string().nullable(),
        created_at: z.string(),
        hosting_version_id: z.string().nullable(),
        revoked_at: z.string().nullable(),
      }),
      sql`select entitlement, source,
        to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as starts_at,
        to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        hosting_version_id, to_char(revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as revoked_at
      from account_entitlement_grants where user_id = ${subject.userId}
      order by entitlement, source`,
    );
    const hostingVersions = await query(
      tx,
      z.object({
        id: z.string(),
        source: z.string(),
        version: z.int(),
        starts_at: z.string(),
        expires_at: z.string(),
        issuer_service_id: z.string().nullable(),
        issuer_operator_ref: z.string().nullable(),
        decision_reference: z.string().nullable(),
        subscription_id: z.string().nullable(),
        subscription_observed_at: z.string().nullable(),
        subscription_evidence: z.json().nullable(),
        coverage: z.json(),
      }),
      sql`select id,source,version,
      to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as starts_at,
      to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at,
      issuer_service_id,issuer_operator_ref,decision_reference,subscription_id,
      to_char(subscription_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as subscription_observed_at,
      subscription_evidence,coverage from account_hosting_versions where user_id=${subject.userId} order by source,version`,
    );
    return {
      account_entitlement_grants: rows.map(
        ({ hosting_version_id, revoked_at, ...row }) =>
          row.entitlement === 'tournament_hosting'
            ? { ...row, hosting_version_id, revoked_at }
            : row,
      ),
      account_hosting_versions: hostingVersions,
    };
  },
};
