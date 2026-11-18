import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  subscriptionEvidenceSchema,
  type SubscriptionEvidence,
} from '@daisy/protocol/billing';
import {
  clubSeatBounds,
  decideClubSeating,
  type ClubSeat,
  type ClubSeating,
  type ClubSeatingCommand,
  type ClubSeatingRefusal,
  type SeatInvitation,
} from '@daisy/protocol/club-seats';
import { normalizeEmail } from '@daisy/protocol/email';
import { sql } from 'drizzle-orm';
import {
  lockClub,
  lockOwnerBillingRows,
  type LockedClub,
} from './billing-owner-lock';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockClubSeatHolderAccounts,
  readClubSeats,
  sameHolders,
  writeClubSeatGrants,
  type ClubSeatGrantProjection,
} from './club-seat-grants';
import { readDatabaseTime } from './database-clock';
import { normalizedEmailSql } from './email-identity';
import { scopeTransaction } from './tenant-scope';
import type { BoundedTransactionContext } from './transaction-context';

type Tx = BoundedTransactionContext;
/** The signed-in person acting: always their own account and actor. */
export type ClubSeatSubject = {
  readonly userId: string;
  readonly actorId: string;
};

/** A manager's command, as the clubs feature sends it. Ids are the club's own. */
export type ClubSeatManagerCommand =
  | { readonly kind: 'invite'; readonly email: string }
  | { readonly kind: 'assign'; readonly userId: string }
  | {
      readonly kind: 'move';
      readonly fromUserId: string;
      readonly to:
        | { readonly kind: 'member'; readonly userId: string }
        | { readonly kind: 'invite'; readonly email: string };
    }
  | { readonly kind: 'remove'; readonly userId: string }
  | { readonly kind: 'cancel'; readonly invitationId: string }
  | { readonly kind: 'resend'; readonly invitationId: string }
  /** Gives up exactly these seats and invitations before a seat decrease. */
  | {
      readonly kind: 'prepare-seat-count';
      readonly seatCount: number;
      readonly release: {
        readonly seats: readonly string[];
        readonly invitations: readonly string[];
      };
    };

export type ClubSeatAnswer =
  | { readonly kind: 'changed' }
  | { readonly kind: 'refused'; readonly reason: ClubSeatingRefusal }
  | {
      /** The Stripe plan to change, after any releases were written. */
      readonly kind: 'seat-count-ready';
      readonly mode: 'test' | 'live';
      readonly vendorCustomerId: string;
      readonly vendorSubscriptionId: string;
      readonly currentSeatCount: number;
      readonly seatCount: number;
    };

/** A refusal decided under the lock: the transaction rolls back and answers it. */
class Refused extends Error {
  constructor(readonly reason: ClubSeatingRefusal) {
    super(reason);
  }
}

/**
 * When a removed seat's Premium ends (point guard, Delivery 5111): the end
 * of that UTC day, never later than the grant already ended.
 */
export const endOfUtcDay = (now: Date) =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

async function readInvitations(
  tx: Tx,
  organizationId: string,
): Promise<readonly SeatInvitation[]> {
  const rows = await tx.execute(
    sql`select id, email, created_at, expires_at from club_seat_invitations
      where organization_id=${organizationId} order by created_at, id for update`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    expiresAt: new Date(row.expires_at as string | Date).toISOString(),
  }));
}

/** The plan's verified facts: seat count 0 and no evidence before a first payment. */
async function readPlan(tx: Tx, organizationId: string) {
  const { customer, subscription } = await lockOwnerBillingRows(tx, {
    kind: 'organization',
    organizationId,
  });
  const evidence: SubscriptionEvidence | null = subscription
    ? subscriptionEvidenceSchema.parse(subscription.evidence)
    : null;
  return {
    customer: customer ?? null,
    subscription: subscription ?? null,
    evidence,
    seatCount: subscription?.seatCount ?? 0,
  };
}

/** Whether a person already holds a seat in another club (one seat per account). */
async function seatedElsewhere(tx: Tx, club: LockedClub, userId: string) {
  await scopeTransaction(tx, {
    organizationId: club.id,
    subjectUserId: userId,
  });
  const rows = await tx.execute(
    sql`select 1 from club_seats where user_id=${userId} and organization_id<>${club.id}`,
  );
  return rows.length > 0;
}

async function isActiveMember(tx: Tx, organizationId: string, userId: string) {
  const rows = await tx.execute(
    sql`select 1 from memberships where organization_id=${organizationId}
      and user_id=${userId} and status='active'`,
  );
  return rows.length > 0;
}

async function queueInvitationMail(
  tx: Tx,
  input: { organizationId: string; invitationId: string; sendId: string },
) {
  // The dedupe key carries the club so the worker can scope its one read.
  await tx.execute(sql`insert into mail_intents
    (id, purpose, club_seat_invitation_id, dedupe_key, next_attempt_at)
    values (${input.sendId}, 'club-seat-invitation', ${input.invitationId},
      ${`club-seat-invitation:${input.organizationId}:${input.invitationId}:${input.sendId}`}, now())`);
}

/** Writes the difference between two seatings, and ends removed holders' Premium at the end of the UTC day. */
async function writeSeating(
  tx: Tx,
  input: {
    readonly club: LockedClub;
    readonly before: ClubSeating;
    readonly after: ClubSeating;
    readonly invitedBy: string;
    readonly now: Date;
    readonly nextId: () => string;
  },
) {
  const { club, before, after } = input;
  const removed = before.seats.filter(
    (seat) => !after.seats.some((next) => next.userId === seat.userId),
  );
  const added = after.seats.filter(
    (seat) => !before.seats.some((prior) => prior.userId === seat.userId),
  );
  const closed = before.invitations.filter(
    (invitation) =>
      !after.invitations.some((next) => next.id === invitation.id),
  );
  const opened = after.invitations.filter(
    (invitation) =>
      !before.invitations.some((prior) => prior.id === invitation.id),
  );
  for (const invitation of closed)
    await tx.execute(
      sql`delete from club_seat_invitations where organization_id=${club.id} and id=${invitation.id}`,
    );
  for (const seat of removed) {
    await tx.execute(
      sql`delete from club_seats where organization_id=${club.id} and user_id=${seat.userId}`,
    );
    await tx.execute(sql`update account_entitlement_grants
      set expires_at = greatest(starts_at, least(expires_at, ${endOfUtcDay(input.now)}))
      where user_id=${seat.userId} and source='organization_seat' and organization_id=${club.id}`);
    await tx.execute(
      sql`update users set version=version+1 where id=${seat.userId}`,
    );
  }
  for (const seat of added) {
    const inserted = await tx.execute(sql`insert into club_seats
      (organization_id, user_id, assigned_at) values (${club.id}, ${seat.userId}, ${seat.assignedAt})
      on conflict do nothing returning user_id`);
    if (inserted.length !== 1) throw new Refused('seated-elsewhere');
  }
  for (const invitation of opened) {
    await tx.execute(sql`insert into club_seat_invitations
      (id, organization_id, email, invited_by_user_id, expires_at, created_at)
      values (${invitation.id}, ${club.id}, ${invitation.email}, ${input.invitedBy},
        ${invitation.expiresAt}, ${invitation.createdAt})`);
    await queueInvitationMail(tx, {
      organizationId: club.id,
      invitationId: invitation.id,
      sendId: input.nextId(),
    });
  }
}

function toSeatingCommand(
  command: ClubSeatManagerCommand,
  facts: {
    readonly invitationId: string;
    readonly target: { member: boolean; elsewhere: boolean } | null;
  },
): ClubSeatingCommand | null {
  switch (command.kind) {
    case 'invite':
      return {
        kind: 'invite',
        invitationId: facts.invitationId,
        email: command.email,
      };
    case 'assign':
      return {
        kind: 'assign',
        target: {
          kind: 'member',
          userId: command.userId,
          isMember: facts.target?.member ?? false,
          seatedElsewhere: facts.target?.elsewhere ?? false,
        },
      };
    case 'move':
      return {
        kind: 'move',
        fromUserId: command.fromUserId,
        to:
          command.to.kind === 'member'
            ? {
                kind: 'member',
                userId: command.to.userId,
                isMember: facts.target?.member ?? false,
                seatedElsewhere: facts.target?.elsewhere ?? false,
              }
            : {
                kind: 'invite',
                invitationId: facts.invitationId,
                email: command.to.email,
              },
      };
    case 'remove':
      return { kind: 'remove', userId: command.userId };
    case 'cancel':
      return { kind: 'cancel', invitationId: command.invitationId };
    case 'prepare-seat-count':
      return {
        kind: 'change-seat-count',
        seatCount: command.seatCount,
        release: command.release,
      };
    case 'resend':
      return null;
  }
}

const targetOf = (command: ClubSeatManagerCommand) =>
  command.kind === 'assign'
    ? command.userId
    : command.kind === 'move' && command.to.kind === 'member'
      ? command.to.userId
      : null;

function validCommand(command: ClubSeatManagerCommand) {
  const ids = (values: readonly string[]) =>
    values.every((value) => idSchema.safeParse(value).success);
  const email = (value: string) =>
    value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  switch (command.kind) {
    case 'invite':
      return email(command.email);
    case 'assign':
    case 'remove':
      return ids([command.userId]);
    case 'move':
      return (
        ids([command.fromUserId]) &&
        (command.to.kind === 'member'
          ? ids([command.to.userId])
          : email(command.to.email))
      );
    case 'cancel':
    case 'resend':
      return ids([command.invitationId]);
    case 'prepare-seat-count':
      return (
        Number.isSafeInteger(command.seatCount) &&
        command.release.seats.length <= clubSeatBounds.maxSeats &&
        command.release.invitations.length <= clubSeatBounds.maxSeats &&
        ids([...command.release.seats, ...command.release.invitations])
      );
  }
}

/**
 * Club seat commands (ADR 0148). Every command takes the fences in the one
 * order: the seat holders' and the people it names' account fences, then
 * the club row, then the club's billing rows; a holder set that changed
 * between the first read and the club lock is a conflict the caller retries.
 * The pure seat rules decide; the writes follow the decision exactly, and
 * the holders' `organization_seat` grants are re-projected in the same
 * transaction. A removed holder keeps Premium until the end of that UTC day.
 */
export function createClubSeats(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly grants: ClubSeatGrantProjection;
}) {
  async function fenced(
    tx: Tx,
    subject: ClubSeatSubject,
    organizationId: string,
    extra: readonly string[],
  ) {
    const holders = await lockClubSeatHolderAccounts(tx, organizationId, [
      subject.userId,
      ...extra,
    ]);
    const club = await lockClub(tx, organizationId, subject.userId);
    if (!club || club.closed) throw createAppError('NOT_FOUND');
    const seats = await readClubSeats(tx, club.id);
    if (!sameHolders(seats, holders.seats)) throw createAppError('CONFLICT');
    return { club, seats };
  }

  async function project(tx: Tx, club: LockedClub, seats: readonly ClubSeat[]) {
    const plan = await readPlan(tx, club.id);
    await writeClubSeatGrants(
      tx,
      club.id,
      input.grants({
        organizationId: club.id,
        evidence: plan.evidence,
        seatCount: plan.seatCount,
        seats,
      }),
    );
  }

  return {
    /** A manager (the club's owner) changes its seats. */
    command(
      subject: ClubSeatSubject,
      organizationId: string,
      command: ClubSeatManagerCommand,
    ): Promise<ClubSeatAnswer> {
      if (!idSchema.safeParse(organizationId).success || !validCommand(command))
        throw createAppError('VALIDATION');
      const target = targetOf(command);
      return input
        .run(async (tx): Promise<ClubSeatAnswer> => {
          const { club, seats } = await fenced(
            tx,
            subject,
            organizationId,
            target ? [target] : [],
          );
          if (club.ownerUserId !== subject.userId)
            throw createAppError('NOT_FOUND');
          const plan = await readPlan(tx, club.id);
          const now = await readDatabaseTime(tx);
          const before: ClubSeating = {
            seatCount: plan.seatCount,
            seats,
            invitations: await readInvitations(tx, club.id),
          };
          if (command.kind === 'resend') {
            const invitation = before.invitations.find(
              (candidate) => candidate.id === command.invitationId,
            );
            if (!invitation) return refused('invitation-not-found');
            if (Date.parse(invitation.expiresAt) <= now.getTime())
              return refused('invitation-expired');
            await queueInvitationMail(tx, {
              organizationId: club.id,
              invitationId: invitation.id,
              sendId: input.nextId(),
            });
            return { kind: 'changed' };
          }
          const facts = {
            invitationId: input.nextId(),
            target: target
              ? {
                  member: await isActiveMember(tx, club.id, target),
                  elsewhere: await seatedElsewhere(tx, club, target),
                }
              : null,
          };
          await scopeTransaction(tx, {
            organizationId: club.id,
            subjectUserId: subject.userId,
          });
          const seatingCommand = toSeatingCommand(command, facts)!;
          const decision = decideClubSeating(
            before,
            seatingCommand,
            now.toISOString(),
          );
          if (decision.kind === 'refused') return refused(decision.reason);
          await writeSeating(tx, {
            club,
            before,
            after: decision.state,
            invitedBy: subject.userId,
            now,
            nextId: input.nextId,
          });
          await project(tx, club, decision.state.seats);
          if (command.kind !== 'prepare-seat-count') return { kind: 'changed' };
          if (
            !plan.customer ||
            !plan.subscription ||
            (plan.customer.mode !== 'test' && plan.customer.mode !== 'live')
          )
            return refused('seat-count-out-of-range');
          return {
            kind: 'seat-count-ready',
            mode: plan.customer.mode,
            vendorCustomerId: plan.customer.vendorCustomerId,
            vendorSubscriptionId: plan.subscription.vendorSubscriptionId,
            currentSeatCount: plan.seatCount,
            seatCount: command.seatCount,
          };
        })
        .catch((error: unknown) => {
          if (error instanceof Refused) return refused(error.reason);
          throw error;
        });
    },

    /**
     * The invited person answers: accepting needs a signed-in account whose
     * verified email is the invited address; it seats them, makes them an
     * active member if they were not, and grants Premium from the plan.
     */
    answer(
      subject: ClubSeatSubject,
      organizationId: string,
      invitationId: string,
      answer: 'accept' | 'decline',
    ): Promise<ClubSeatAnswer> {
      if (
        !idSchema.safeParse(organizationId).success ||
        !idSchema.safeParse(invitationId).success
      )
        throw createAppError('VALIDATION');
      return input
        .run(async (tx): Promise<ClubSeatAnswer> => {
          const { club, seats } = await fenced(tx, subject, organizationId, []);
          const invitation = await invitedAs(tx, subject, club, invitationId);
          if (!invitation) throw createAppError('NOT_FOUND');
          const plan = await readPlan(tx, club.id);
          const now = await readDatabaseTime(tx);
          const before: ClubSeating = {
            seatCount: plan.seatCount,
            seats,
            invitations: await readInvitations(tx, club.id),
          };
          const elsewhere = await seatedElsewhere(tx, club, subject.userId);
          await scopeTransaction(tx, {
            organizationId: club.id,
            subjectUserId: subject.userId,
          });
          const decision = decideClubSeating(
            before,
            answer === 'accept'
              ? {
                  kind: 'accept',
                  invitationId,
                  userId: subject.userId,
                  seatedElsewhere: elsewhere,
                }
              : { kind: 'decline', invitationId },
            now.toISOString(),
          );
          if (decision.kind === 'refused') return refused(decision.reason);
          await writeSeating(tx, {
            club,
            before,
            after: decision.state,
            invitedBy: subject.userId,
            now,
            nextId: input.nextId,
          });
          if (answer === 'accept') {
            await tx.execute(sql`insert into memberships
              (organization_id, user_id, status, joined_at) values (${club.id}, ${subject.userId}, 'active', ${now})
              on conflict (organization_id, user_id) do update
                set status='active', joined_at=coalesce(memberships.joined_at, excluded.joined_at),
                  ended_at=null, version=memberships.version+1
                where memberships.status <> 'active'`);
            await project(tx, club, decision.state.seats);
          }
          return { kind: 'changed' };
        })
        .catch((error: unknown) => {
          if (error instanceof Refused) return refused(error.reason);
          throw error;
        });
    },
  };
}

const refused = (reason: ClubSeatingRefusal): ClubSeatAnswer => ({
  kind: 'refused',
  reason,
});

/** The invitation, when it is addressed to the subject's verified email. */
export async function invitedAs(
  tx: Tx,
  subject: ClubSeatSubject,
  club: LockedClub,
  invitationId: string,
) {
  const rows = await tx.execute(sql`select i.id, i.email, i.expires_at
    from club_seat_invitations i, users u
    where i.organization_id=${club.id} and i.id=${invitationId}
      and u.id=${subject.userId} and u.deleted_at is null and u.email_verified
      and ${normalizedEmailSql(sql`u.email`)} = i.email`);
  const [row] = rows;
  return row
    ? {
        id: String(row.id),
        email: normalizeEmail(String(row.email)),
        expiresAt: new Date(row.expires_at as string | Date).toISOString(),
      }
    : null;
}
