import { listedWord } from './lifecycle-sql';
import {
  entitlementGrantSchema,
  type EntitlementGrant,
  entitlementSources,
} from '@daisy/protocol/entitlements';
import { sql } from 'drizzle-orm';
import type { Tx } from './tx';
import { run, query } from './raw-rows';
import { z } from 'zod';

/**
 * An account's entitlement grants. Read inside the caller's transaction:
 * a claim that holds the account's canonical fence reads grants that the
 * beta command, which bumps the same fence, cannot change underneath it.
 */
export async function readEntitlementGrants(
  tx: Tx,
  userId: string,
): Promise<readonly EntitlementGrant[]> {
  const rows = await query(
    tx,
    z.object({
      entitlement: z.string(),
      source: z.string(),
      organizationId: z.string().nullable(),
      startsAt: z.string().nullable(),
      expiresAt: z.string().nullable(),
      hosting: z.json(),
    }),
    sql`select g.entitlement, g.source, g.organization_id as "organizationId",
      to_char(g.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "startsAt",
      to_char(g.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "expiresAt",
      case when v.id is not null then jsonb_build_object(
        'id',v.id, 'userId',v.user_id, 'version',v.version,
        'startsAt',to_char(v.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(v.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'issuer',case v.source when 'administrative' then jsonb_build_object('kind',v.source,'serviceId',v.issuer_service_id,'operatorRef',v.issuer_operator_ref,'decisionReference',v.decision_reference) else jsonb_build_object('kind',v.source,'subscriptionId',v.subscription_id,'observedAt',to_char(v.subscription_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'evidence',v.subscription_evidence) end, 'coverage',v.coverage
      ) end as hosting
    from account_entitlement_grants g
    left join account_hosting_versions v on v.id = g.hosting_version_id
      and v.user_id = g.user_id and v.source = g.source
    where g.user_id = ${userId} and g.revoked_at is null
    order by g.entitlement, g.source`,
  );
  return rows.map((value) => {
    return entitlementGrantSchema.parse(
      value.entitlement === 'tournament_hosting'
        ? {
            entitlement: value.entitlement,
            source: value.source,
            hosting: value.hosting,
          }
        : value.source === 'organization_seat'
          ? {
              entitlement: value.entitlement,
              source: value.source,
              organizationId: value.organizationId,
              startsAt: value.startsAt,
              expiresAt: value.expiresAt,
            }
          : {
              entitlement: value.entitlement,
              source: value.source,
              startsAt: value.startsAt,
              expiresAt: value.expiresAt,
            },
    );
  });
}

/** What beta approval grants (DEC-247, DEC-183, WATCH-16, WATCH-8) until billing exists. */
const betaGrants = [
  'round_analysis',
  'ai_rounds',
  'casual_ai_judge',
  'casual_capture',
  'recording_download',
] as const;

/**
 * Writes the account's `beta` grants for its new beta state, in the beta
 * access command's transaction: approval grants them and any other state
 * removes them.
 */
export async function applyBetaEntitlementGrants(
  tx: Tx,
  userId: string,
  state: 'approved' | 'revoked',
) {
  if (state === 'approved')
    await run(
      tx,
      sql`insert into account_entitlement_grants (user_id, entitlement, source)
      select ${userId}, entitlement, 'beta' from unnest(${`{${betaGrants.join(',')}}`}::text[]) as entitlement
      on conflict do nothing`,
    );
  else
    await run(
      tx,
      sql`delete from account_entitlement_grants where user_id = ${userId} and source = ${listedWord(entitlementSources, 'beta')}`,
    );
}
