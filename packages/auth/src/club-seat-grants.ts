import type { EntitlementGrant } from '@daisy/protocol';
import type { SubscriptionEvidence } from '@daisy/protocol/billing';
import { fundedSeats, type ClubSeat } from '@daisy/protocol/club-seats';
import { premiumGrantWindows } from './subscription-policy';

export type SeatHolderGrants = {
  readonly userId: string;
  /** Empty when the seat is unfunded or the club plan grants no access. */
  readonly grants: readonly Extract<
    EntitlementGrant,
    { source: 'organization_seat' }
  >[];
};

/**
 * The entitlement projection for one club (ADR 0148): a seat holder has the
 * Premium grants, source `organization_seat`, exactly while the club plan's
 * verified evidence grants access (the same paid period and renewal grace as
 * personal Premium) and their seat is within the paid seat count. Every
 * holder appears, so a writer can revoke as well as grant. Pure and total.
 */
export function clubSeatGrants(input: {
  readonly organizationId: string;
  readonly evidence: SubscriptionEvidence | null;
  readonly seatCount: number;
  readonly seats: readonly ClubSeat[];
}): readonly SeatHolderGrants[] {
  const windows = input.evidence ? premiumGrantWindows(input.evidence) : [];
  const funded = new Set(
    fundedSeats(input.seats, input.seatCount).map((seat) => seat.userId),
  );
  return [...input.seats]
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .map((seat) => ({
      userId: seat.userId,
      grants: funded.has(seat.userId)
        ? windows.map((window) => ({
            entitlement: window.entitlement,
            source: 'organization_seat' as const,
            organizationId: input.organizationId,
            startsAt: window.startsAt,
            expiresAt: window.expiresAt,
          }))
        : [],
    }));
}
