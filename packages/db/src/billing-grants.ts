import { entitlementKinds, type EntitlementGrant } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { BoundedTransactionContext } from './transaction-context';

const grantsSchema = z
  .array(
    z
      .strictObject({
        entitlement: z.enum(entitlementKinds),
        source: z.literal('subscription'),
        startsAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
      })
      .refine(
        (grant) => Date.parse(grant.startsAt) < Date.parse(grant.expiresAt),
      ),
  )
  .max(entitlementKinds.length)
  .refine(
    (grants) =>
      new Set(grants.map((g) => g.entitlement)).size === grants.length,
  );

/** Called under the canonical account fence, in the same transaction as verified evidence. */
export async function replaceSubscriptionGrants(
  tx: BoundedTransactionContext,
  userId: string,
  grants: readonly EntitlementGrant[],
) {
  const parsed = grantsSchema.safeParse(grants);
  if (!parsed.success) throw createAppError('VALIDATION');
  await tx.execute(sql`delete from account_entitlement_grants where user_id=${userId} and source='subscription'
    and entitlement not in (select value->>'entitlement' from jsonb_array_elements(${JSON.stringify(parsed.data)}::text::jsonb))`);
  if (parsed.data.length)
    await tx.execute(sql`insert into account_entitlement_grants(user_id,entitlement,source,starts_at,expires_at)
      select ${userId},value->>'entitlement','subscription', (value->>'startsAt')::timestamptz,(value->>'expiresAt')::timestamptz
      from jsonb_array_elements(${JSON.stringify(parsed.data)}::text::jsonb)
      on conflict (user_id,entitlement,source) do update set starts_at=excluded.starts_at,expires_at=excluded.expires_at`);
  await tx.execute(sql`update users set version=version+1 where id=${userId}`);
}
