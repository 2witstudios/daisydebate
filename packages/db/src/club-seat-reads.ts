import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  subscriptionEvidenceSchema,
  type SubscriptionEvidence,
} from '@daisy/protocol/billing';
import type { ClubSeat, SeatInvitation } from '@daisy/protocol/club-seats';
import { and, eq, sql } from 'drizzle-orm';
import { loadAuthorizationAccount } from './authorization';
import { ownedBy, type LockedClub } from './billing-owner-lock';
import { billingCustomers } from './schema/billing-customers';
import { billingSubscriptions } from './schema/billing-subscriptions';
import type { BoundedTransaction } from './bounded-transaction';
import { invitedAs, type ClubSeatSubject } from './club-seat-commands';
import { readClubSeats } from './club-seat-grants';
import { readDatabaseTime } from './database-clock';
import { scopeTransaction } from './tenant-scope';
import type { BoundedTransactionContext } from './transaction-context';

type Tx = BoundedTransactionContext;
export type ClubPerson = {
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
  readonly ageBand: 'minor' | 'adult' | null;
};
/** What a club manager sees: the club, its plan's verified facts and its seating. */
export type ClubSeatingRead = {
  readonly club: Omit<LockedClub, 'revision' | 'closed'>;
  readonly now: string;
  readonly plan: {
    readonly evidence: SubscriptionEvidence | null;
    readonly seatCount: number;
    readonly renewalOff: boolean;
    readonly amountMinor: number | null;
    readonly hasCustomer: boolean;
    /** The Stripe subscription, for the club's invoice list; null before a first payment. */
    readonly vendorSubscriptionId: string | null;
  };
  readonly seats: readonly (ClubSeat & { readonly person: ClubPerson })[];
  readonly invitations: readonly SeatInvitation[];
  /** Active members without a seat here: who a seat may move or be assigned to. */
  readonly members: readonly ClubPerson[];
};

async function readClub(tx: Tx, organizationId: string) {
  const [row] = await tx.execute(
    sql`select id, kind, name, handle, owner_user_id from organizations
      where id=${organizationId} and closed_at is null and kind in ('school','family')`,
  );
  return row && typeof row.owner_user_id === 'string'
    ? {
        id: String(row.id),
        kind: row.kind as LockedClub['kind'],
        name: String(row.name),
        handle: String(row.handle),
        ownerUserId: row.owner_user_id,
      }
    : null;
}

async function person(tx: Tx, userId: string): Promise<ClubPerson> {
  const [row] = await tx.execute(
    sql`select name, username from users where id=${userId}`,
  );
  const account = await loadAuthorizationAccount(tx, userId);
  const band = account?.ageBand ?? null;
  return {
    userId,
    name: String(row?.name ?? '') || String(row?.username ?? 'Member'),
    username: row?.username ? String(row.username) : null,
    ageBand: band === null ? null : band === 'adult' ? 'adult' : 'minor',
  };
}

/** Club reads (ADR 0148): a manager's view of one club, an invitee's view of their invitation, a holder's seat. */
export function createClubSeatReads(input: {
  readonly run: BoundedTransaction;
}) {
  return {
    /** The club by handle, when the subject manages it (its owner). */
    clubByHandle(subject: ClubSeatSubject, handle: string) {
      if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(handle))
        return Promise.resolve(null);
      return input.run(async (tx) => {
        const [row] = await tx.execute(
          sql`select id from organizations where handle=${handle}
            and owner_user_id=${subject.userId} and closed_at is null
            and kind in ('school','family')`,
        );
        return row ? String(row.id) : null;
      });
    },

    seating(
      subject: ClubSeatSubject,
      organizationId: string,
    ): Promise<ClubSeatingRead | null> {
      if (!idSchema.safeParse(organizationId).success)
        throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        await scopeTransaction(tx, {
          organizationId,
          subjectUserId: subject.userId,
        });
        const club = await readClub(tx, organizationId);
        if (!club || club.ownerUserId !== subject.userId) return null;
        // A read takes no row locks: the page reads the plan, never fences it.
        const [customer] = await tx
          .select()
          .from(billingCustomers)
          .where(
            ownedBy(billingCustomers, { kind: 'organization', organizationId }),
          );
        const [subscription] = await tx
          .select()
          .from(billingSubscriptions)
          .where(
            and(
              ownedBy(billingSubscriptions, {
                kind: 'organization',
                organizationId,
              }),
              eq(billingSubscriptions.current, true),
            ),
          );
        const seats = await readClubSeats(tx, organizationId);
        const invitations = await tx.execute(
          sql`select id, email, created_at, expires_at from club_seat_invitations
            where organization_id=${organizationId} order by created_at, id`,
        );
        const memberRows = await tx.execute(
          sql`select user_id from memberships where organization_id=${organizationId}
            and status='active' order by user_id limit 500`,
        );
        const seated = new Set(seats.map((seat) => seat.userId));
        const people = await Promise.all(
          seats.map(async (seat) => ({
            ...seat,
            person: await person(tx, seat.userId),
          })),
        );
        const members: ClubPerson[] = [];
        for (const row of memberRows) {
          const userId = String(row.user_id);
          if (!seated.has(userId)) members.push(await person(tx, userId));
        }
        return {
          club,
          now: (await readDatabaseTime(tx)).toISOString(),
          plan: {
            evidence: subscription
              ? subscriptionEvidenceSchema.parse(subscription.evidence)
              : null,
            seatCount: subscription?.seatCount ?? 0,
            renewalOff: subscription?.renewalOff ?? false,
            amountMinor: subscription?.amountMinor ?? null,
            hasCustomer: customer !== undefined && customer.closedAt === null,
            vendorSubscriptionId: subscription?.vendorSubscriptionId ?? null,
          },
          seats: people,
          invitations: invitations.map((row) => ({
            id: String(row.id),
            email: String(row.email),
            createdAt: new Date(row.created_at as string | Date).toISOString(),
            expiresAt: new Date(row.expires_at as string | Date).toISOString(),
          })),
          members,
        };
      });
    },

    /** An invitation as its addressee sees it; null unless it is theirs. */
    invitation(
      subject: ClubSeatSubject,
      organizationId: string,
      invitationId: string,
    ) {
      if (
        !idSchema.safeParse(organizationId).success ||
        !idSchema.safeParse(invitationId).success
      )
        return Promise.resolve(null);
      return input.run(async (tx) => {
        await scopeTransaction(tx, {
          organizationId,
          subjectUserId: subject.userId,
        });
        const club = await readClub(tx, organizationId);
        if (!club) return null;
        const invitation = await invitedAs(
          tx,
          subject,
          { ...club, closed: false, revision: 0 },
          invitationId,
        );
        const owner = await person(tx, club.ownerUserId);
        if (!invitation) {
          // Accepted: the invitation is gone, and the link now shows the seat.
          const [held] = await tx.execute(
            sql`select assigned_at from club_seats where organization_id=${organizationId}
              and user_id=${subject.userId}`,
          );
          return held
            ? {
                club: { name: club.name, kind: club.kind, handle: club.handle },
                manager: owner.name,
                email: '',
                expiresAt: new Date(
                  held.assigned_at as string | Date,
                ).toISOString(),
                expired: false,
                seatedHere: true,
                seatedElsewhere: false,
              }
            : null;
        }
        const own = await tx.execute(
          sql`select organization_id from club_seats where user_id=${subject.userId}`,
        );
        const now = (await readDatabaseTime(tx)).toISOString();
        return {
          club: { name: club.name, kind: club.kind, handle: club.handle },
          manager: owner.name,
          email: invitation.email,
          expiresAt: invitation.expiresAt,
          expired: Date.parse(invitation.expiresAt) <= Date.parse(now),
          seatedHere: own.some(
            (row) => String(row.organization_id) === organizationId,
          ),
          seatedElsewhere: own.some(
            (row) => String(row.organization_id) !== organizationId,
          ),
        };
      });
    },

    /** The club whose seat gives this person Premium, for Settings › Billing. */
    seatOf(subject: ClubSeatSubject) {
      return input.run(async (tx) => {
        await scopeTransaction(tx, { subjectUserId: subject.userId });
        // Only a seat whose Premium is current: an unfunded seat or a lapsed plan shows nothing.
        const [seat] = await tx.execute(
          sql`select s.organization_id from club_seats s
            where s.user_id=${subject.userId} and exists (
              select 1 from account_entitlement_grants g
              where g.user_id=s.user_id and g.source='organization_seat'
                and g.organization_id=s.organization_id
                and g.starts_at <= now() and g.expires_at > now())`,
        );
        if (!seat) return null;
        const organizationId = String(seat.organization_id);
        await scopeTransaction(tx, {
          organizationId,
          subjectUserId: subject.userId,
        });
        const club = await readClub(tx, organizationId);
        if (!club) return null;
        return {
          name: club.name,
          manager: (await person(tx, club.ownerUserId)).name,
        };
      });
    },
  };
}
