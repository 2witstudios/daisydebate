import { instantMs } from '@daisy/clock';
import { z } from 'zod';
import { subscriptionAccess } from '@daisy/auth/authorization';
import type { ClubSeatingRead } from '@daisy/db';
import {
  fundedSeats,
  liveInvitations,
  lowestSeatCount,
  seatsUsed,
} from '@daisy/protocol/club-seats';
import { clubSeatOffer } from '../billing/club-price';
import type { ClubInvoiceRow } from '../billing/club-billing';

const id = z.string().regex(/^[a-z0-9]{24}$/);
const club = z.strictObject({
  id,
  name: z.string().min(1).max(120),
  handle: z.string().min(3).max(40),
  kind: z.enum(['school', 'family']),
});
/**
 * The club plan as copy shows it. `none` is before a first payment;
 * `payment-due` is the renewal grace; `ended` is a lapsed or cancelled plan.
 */
const plan = z.strictObject({
  state: z.enum(['none', 'active', 'cancelled', 'payment-due', 'ended']),
  seatCount: z.number().int().min(0).max(200),
  seatsUsed: z.number().int().min(0).max(400),
  lowestSeatCount: z.number().int().min(1).max(400),
  /** The renewal (or end) of the paid period; the grace end while payment is due. */
  renewsAt: z.iso.datetime().nullable(),
  /** The current period, for a seat increase's proration estimate. */
  periodStartsAt: z.iso.datetime().nullable(),
  periodEndsAt: z.iso.datetime().nullable(),
  seatPriceMinor: z.number().int().positive(),
  monthlyTotalMinor: z.number().int().nonnegative(),
});
const person = z.strictObject({
  userId: id,
  name: z.string().min(1).max(200),
  username: z.string().max(64).nullable(),
  /** Youth or Open by age band; null when the band is unknown. */
  ladder: z.enum(['youth', 'open']).nullable(),
});

export const clubSeatsViewSchema = z.strictObject({
  club,
  plan,
  seats: z
    .array(
      person.extend({
        assignedAt: z.iso.datetime(),
        /** False when the paid seat count no longer covers this seat. */
        funded: z.boolean(),
      }),
    )
    .max(200),
  invitations: z
    .array(
      z.strictObject({
        id,
        email: z.string().max(320),
        expiresAt: z.iso.datetime(),
        expired: z.boolean(),
      }),
    )
    .max(250),
  /** Active members without a seat: who a seat may be assigned or moved to. */
  members: z.array(person).max(500),
});
export type ClubSeatsView = z.infer<typeof clubSeatsViewSchema>;

export const clubBillingViewSchema = z.strictObject({
  club,
  plan,
  invoices: z
    .array(
      z.strictObject({
        id: z.string(),
        date: z.iso.datetime(),
        kind: z.enum(['renewal', 'seat-change', 'other']),
        totalMinor: z.number().int(),
        status: z.enum(['paid', 'open', 'void', 'uncollectible', 'draft']),
      }),
    )
    .max(12),
  portalAvailable: z.boolean(),
  /** Seats can be bought or changed: Club billing is configured and released. */
  purchaseAvailable: z.boolean(),
});
export type ClubBillingView = z.infer<typeof clubBillingViewSchema>;

export const clubInvitationViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('open'),
    club: club.pick({ name: true, kind: true }),
    manager: z.string().min(1).max(200),
    email: z.string().max(320),
    expiresAt: z.iso.datetime(),
    /** The invitee pays for Premium themselves; that subscription stays until they cancel it. */
    ownPremium: z.boolean(),
  }),
  z.strictObject({
    kind: z.enum(['expired', 'seated-here', 'seated-elsewhere']),
    club: club.pick({ name: true, kind: true }),
    manager: z.string().min(1).max(200),
  }),
]);
export type ClubInvitationView = z.infer<typeof clubInvitationViewSchema>;

/** How many lapsed invitations the board lists for resending. */
const lapsedShown = 50;

const ladderOf = (band: 'minor' | 'adult' | null) =>
  band === null
    ? null
    : band === 'adult'
      ? ('open' as const)
      : ('youth' as const);

function planView(read: ClubSeatingRead) {
  const { evidence, seatCount } = read.plan;
  const seating = {
    seatCount,
    seats: read.seats,
    invitations: read.invitations,
  };
  const access = evidence
    ? subscriptionAccess(evidence, read.now)
    : ({ kind: 'none' } as const);
  const period =
    evidence && evidence.settlement.kind !== 'unpaid'
      ? evidence.settlement.kind === 'renewal_failed'
        ? evidence.settlement.previous.period
        : evidence.settlement.period
      : null;
  // Checkout completed but the first invoice is not yet verified paid: the
  // plan is still starting, not ended.
  const starting =
    evidence !== null &&
    evidence.settlement.kind === 'unpaid' &&
    ['incomplete', 'active', 'trialing'].includes(evidence.lifecycle);
  const state =
    evidence === null || starting
      ? 'none'
      : access.kind === 'paid'
        ? read.plan.renewalOff
          ? 'cancelled'
          : 'active'
        : access.kind === 'grace'
          ? 'payment-due'
          : 'ended';
  const unit = read.plan.amountMinor ?? clubSeatOffer.unitAmount;
  return plan.parse({
    state,
    seatCount,
    seatsUsed: seatsUsed(seating, read.now),
    lowestSeatCount: lowestSeatCount(seating, read.now),
    renewsAt:
      access.kind === 'none'
        ? null
        : access.kind === 'grace'
          ? access.expiresAt
          : access.period.endsAt,
    periodStartsAt: period?.startsAt ?? null,
    periodEndsAt: period?.endsAt ?? null,
    seatPriceMinor: unit,
    monthlyTotalMinor: unit * seatCount,
  });
}

const clubOf = (read: ClubSeatingRead) =>
  club.parse({
    id: read.club.id,
    name: read.club.name,
    handle: read.club.handle,
    kind: read.club.kind,
  });

/** The seats board: who holds a seat, who is invited, who could be given one. */
export function clubSeatsView(read: ClubSeatingRead): ClubSeatsView {
  const funded = new Set(
    fundedSeats(read.seats, read.plan.seatCount).map((seat) => seat.userId),
  );
  const live = new Set(
    liveInvitations(
      {
        seatCount: read.plan.seatCount,
        seats: read.seats,
        invitations: read.invitations,
      },
      read.now,
    ).map((invitation) => invitation.id),
  );
  return clubSeatsViewSchema.parse({
    club: clubOf(read),
    plan: planView(read),
    seats: read.seats.map((seat) => ({
      userId: seat.userId,
      name: seat.person.name,
      username: seat.person.username,
      ladder: ladderOf(seat.person.ageBand),
      assignedAt: seat.assignedAt,
      funded: funded.has(seat.userId),
    })),
    // Every live invitation (at most one per seat), and the latest lapsed ones
    // to resend; lapsed rows wait 30 days for their purge.
    invitations: [
      ...read.invitations.filter((invitation) => live.has(invitation.id)),
      ...read.invitations
        .filter((invitation) => !live.has(invitation.id))
        .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))
        .slice(0, lapsedShown),
    ].map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      expired: !live.has(invitation.id),
    })),
    members: read.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      username: member.username,
      ladder: ladderOf(member.ageBand),
    })),
  });
}

export function clubBillingView(
  read: ClubSeatingRead,
  input: {
    readonly invoices: readonly ClubInvoiceRow[];
    readonly configured: boolean;
    readonly released: boolean;
  },
): ClubBillingView {
  return clubBillingViewSchema.parse({
    club: clubOf(read),
    plan: planView(read),
    invoices: input.invoices,
    portalAvailable: input.configured && read.plan.hasCustomer,
    purchaseAvailable: input.configured && input.released,
  });
}

/**
 * A seat increase's estimate as the board shows it ("you pay $9.33 now"):
 * the added seats for the rest of the paid period, rounded to the cent.
 * Display only; Stripe's invoice is what is charged.
 */
export function prorationEstimateMinor(input: {
  readonly addedSeats: number;
  readonly seatPriceMinor: number;
  readonly periodStartsAt: string;
  readonly periodEndsAt: string;
  readonly now: string;
}) {
  const start = instantMs(input.periodStartsAt);
  const end = instantMs(input.periodEndsAt);
  const now = Math.min(Math.max(instantMs(input.now), start), end);
  if (!(end > start) || input.addedSeats <= 0) return 0;
  return Math.round(
    (input.addedSeats * input.seatPriceMinor * (end - now)) / (end - start),
  );
}
