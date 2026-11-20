import { createAppError } from '@daisy/errors';
import { entitlementKinds, type EntitlementGrant } from '@daisy/protocol';
import type { SubscriptionEvidence } from '@daisy/protocol/billing';
import type { ClubSeat } from '@daisy/protocol/club-seats';
import { clubSeatBounds } from '@daisy/protocol/club-seats';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { lockAuthorizationActors } from './authorization';
import { scopeTransaction } from './tenant-scope';
import type { Tx } from './tx';
import { run } from './raw-rows';

type SeatGrant = Extract<EntitlementGrant, { source: 'organization_seat' }>;
/** One holder's projected grants: what `clubSeatGrants` (auth) returns per seat. */
export type SeatHolderGrants = {
  readonly userId: string;
  readonly grants: readonly SeatGrant[];
};
/** The pure projection, injected from @daisy/auth (db never imports policy). */
export type ClubSeatGrantProjection = (input: {
  readonly organizationId: string;
  readonly evidence: SubscriptionEvidence | null;
  readonly seatCount: number;
  readonly seats: readonly ClubSeat[];
}) => readonly SeatHolderGrants[];

const holderGrantsSchema = z
  .array(
    z.strictObject({
      entitlement: z.enum(entitlementKinds),
      source: z.literal('organization_seat'),
      organizationId: z.string(),
      startsAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    }),
  )
  .max(entitlementKinds.length);

/** A club's seats, read under its scope (set by the caller's club lock or here). */
export async function readClubSeats(
  tx: Tx,
  organizationId: string,
): Promise<readonly ClubSeat[]> {
  const rows = await tx.execute(
    sql`select user_id, assigned_at from club_seats
      where organization_id=${organizationId} order by user_id`,
  );
  return rows.map((row) => ({
    userId: String(row.user_id),
    assignedAt: new Date(row.assigned_at as string | Date).toISOString(),
  }));
}

/**
 * Takes the account fences of a club's seat holders plus any extra people (a
 * new holder, the acting manager), in the canonical order, BEFORE the club
 * row is locked. The caller re-reads the seats after locking the club and
 * treats a different holder set as stale.
 */
export async function lockClubSeatHolderAccounts(
  tx: Tx,
  organizationId: string,
  extraUserIds: readonly string[] = [],
) {
  await scopeTransaction(tx, { organizationId });
  const seats = await readClubSeats(tx, organizationId);
  const userIds = [
    ...new Set([...seats.map((seat) => seat.userId), ...extraUserIds]),
  ];
  if (userIds.length === 0) return { seats, accounts: [] };
  const actors = await tx.execute(
    sql`select id, user_id from actors where kind='human'
      and user_id in (${sql.join(
        userIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
  );
  const accounts = await lockAuthorizationActors(
    tx,
    actors.map((row) => String(row.id)),
    { maxActors: clubSeatBounds.maxSeats + 2 },
  );
  return { seats, accounts };
}

export const sameHolders = (
  left: readonly ClubSeat[],
  right: readonly ClubSeat[],
) =>
  left.length === right.length &&
  left.every((seat) => right.some((other) => other.userId === seat.userId));

/**
 * Replaces each holder's `organization_seat` grants with the projection,
 * idempotently, under the holders' account fences and the club lock. A holder
 * with no projected grants (unfunded, or no access) is revoked.
 */
export async function writeClubSeatGrants(
  tx: Tx,
  organizationId: string,
  holders: readonly SeatHolderGrants[],
) {
  for (const holder of holders) {
    const parsed = holderGrantsSchema.safeParse(holder.grants);
    if (
      !parsed.success ||
      parsed.data.some((grant) => grant.organizationId !== organizationId)
    )
      throw createAppError('VALIDATION');
    const grants = JSON.stringify(parsed.data);
    await run(
      tx,
      sql`delete from account_entitlement_grants
      where user_id=${holder.userId} and source='organization_seat'
      and (organization_id <> ${organizationId} or entitlement not in
        (select value->>'entitlement' from jsonb_array_elements(${grants}::text::jsonb)))`,
    );
    if (parsed.data.length)
      await run(
        tx,
        sql`insert into account_entitlement_grants
        (user_id, entitlement, source, organization_id, starts_at, expires_at)
        select ${holder.userId}, value->>'entitlement', 'organization_seat', ${organizationId},
          (value->>'startsAt')::timestamptz, (value->>'expiresAt')::timestamptz
        from jsonb_array_elements(${grants}::text::jsonb)
        on conflict (user_id, entitlement, source) do update
          set organization_id=excluded.organization_id,
            starts_at=excluded.starts_at, expires_at=excluded.expires_at`,
      );
    await run(
      tx,
      sql`update users set version=version+1 where id=${holder.userId}`,
    );
  }
}
