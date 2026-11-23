import { entitlementSources } from '@daisy/protocol/entitlements';
import { mailJobStates } from './schema/columns';
import {
  mailIntentPurposes,
  mailIntentErrorCodes,
} from './schema/mail-intents';
import { membershipStatuses } from '@daisy/protocol/lobby';
import { listedWord, listedWords } from './lifecycle-sql';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import {
  subscriptionEvidenceSchema,
  type SubscriptionEvidence,
} from '@daisy/protocol/billing';
import {
  clubSeatBounds,
  clubInvitationMailRefusal,
  type ClubInvitationMailFacts,
  type ClubSeat,
  type ClubSeating,
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
import { activateSeatMembership } from './tab/seat-membership';
import type { Tx } from './tx';
import { run as runStatement, query } from './raw-rows';
import { z } from 'zod';

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

/** The persisted facts available to the application's resend decision. */
export type ClubInvitationResendFacts = {
  readonly evidence: SubscriptionEvidence | null;
  readonly seatCount: number;
  readonly now: string;
  readonly invitation: SeatInvitation | null;
};

type ClubInviteeAnswer = Exclude<ClubSeatAnswer, { kind: 'seat-count-ready' }>;
type ClubInviteeLoad = {
  readonly before: ClubSeating;
  readonly now: string;
  readonly elsewhere: boolean;
  readonly apply: (after: ClubSeating) => Promise<void>;
};

type ClubManagerLoad = {
  readonly before: ClubSeating;
  readonly evidence: SubscriptionEvidence | null;
  readonly now: string;
  readonly invitationId: string;
  readonly target: {
    readonly member: boolean;
    readonly elsewhere: boolean;
  } | null;
  readonly customer: {
    readonly mode: string;
    readonly vendorCustomerId: string;
  } | null;
  readonly subscription: { readonly vendorSubscriptionId: string } | null;
  readonly mail: () => Promise<ClubInvitationMailFacts>;
  readonly apply: (after: ClubSeating) => Promise<void>;
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
  const rows = await query(
    tx,
    z.object({
      id: z.string(),
      email: z.string(),
      created_at: z.date(),
      expires_at: z.date(),
    }),
    sql`select id, email, created_at, expires_at from club_seat_invitations
      where organization_id=${organizationId} order by created_at, id for update`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    expiresAt: row.expires_at.toISOString(),
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
  const rows = await query(
    tx,
    z.object({ present: z.literal(1) }),
    sql`select 1 as present from club_seats where user_id=${userId} and organization_id<>${club.id}`,
  );
  return rows.length > 0;
}

async function isActiveMember(tx: Tx, organizationId: string, userId: string) {
  const rows = await query(
    tx,
    z.object({ present: z.literal(1) }),
    sql`select 1 as present from memberships where organization_id=${organizationId}
      and user_id=${userId} and status=${listedWord(membershipStatuses, 'active')}`,
  );
  return rows.length > 0;
}

async function queueInvitationMail(
  tx: Tx,
  input: { organizationId: string; invitationId: string; sendId: string },
) {
  // The dedupe key carries the club so the worker can scope its one read.
  await runStatement(
    tx,
    sql`insert into mail_intents
    (id, purpose, club_seat_invitation_id, dedupe_key, next_attempt_at)
    values (${input.sendId}, 'club-seat-invitation', ${input.invitationId},
      ${`club-seat-invitation:${input.organizationId}:${input.invitationId}:${input.sendId}`}, now())`,
  );
}

/**
 * Invitation mail is bounded (ADR 0148): one invitation sends at most once an
 * hour, never while a send is still waiting, and five times in all; a club
 * sends at most 20 plus one per seat a day. Counted from the durable mail
 * intents, whose dedupe key names the club and the invitation.
 */
async function readInvitationMailFacts(
  tx: Tx,
  input: {
    readonly organizationId: string;
    readonly invitationId: string | null;
    readonly seatCount: number;
    readonly now: Date;
  },
) {
  const club = `club-seat-invitation:${input.organizationId}:%`;
  const [today] = await query(
    tx,
    z.object({ n: z.int() }),
    sql`select count(*)::int as n from mail_intents
    where purpose = ${listedWord(mailIntentPurposes, 'club-seat-invitation')}
      and created_at > ${input.now}::timestamptz - interval '1 day'
      and dedupe_key like ${club}`,
  );
  const daily = Number(today?.n ?? 0);
  // Preserve the daily-cap short circuit before any invitation-count query.
  if (
    input.invitationId === null ||
    clubInvitationMailRefusal({ daily, invitation: null }, input.seatCount)
  )
    return { daily, invitation: null };
  const [sent] = await query(
    tx,
    z.object({ n: z.int(), recent: z.int() }),
    sql`select count(*)::int as n,
      count(*) filter (where state in ${listedWords(mailJobStates, ['queued', 'leased'])}
        or created_at > ${input.now}::timestamptz - ${`${clubSeatBounds.resendAfterMs} milliseconds`}::interval)::int as recent
    from mail_intents where club_seat_invitation_id=${input.invitationId}`,
  );
  return {
    daily,
    invitation: {
      total: Number(sent?.n ?? 0),
      recentOrOwed: Number(sent?.recent ?? 0),
    },
  };
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
  for (const invitation of closed) {
    // An answered or cancelled offer is no longer owed: its unsent mail ends first.
    await runStatement(
      tx,
      sql`update mail_intents set state=${listedWord(mailJobStates, 'cancelled')}, last_error_code=${listedWord(mailIntentErrorCodes, 'not-owed')},
        completed_at=clock_timestamp(), lease_token_digest=null, lease_expires_at=null
      where club_seat_invitation_id=${invitation.id} and state in ${listedWords(mailJobStates, ['queued', 'leased'])}`,
    );
    await runStatement(
      tx,
      sql`delete from club_seat_invitations where organization_id=${club.id} and id=${invitation.id}`,
    );
  }
  for (const seat of removed) {
    await runStatement(
      tx,
      sql`delete from club_seats where organization_id=${club.id} and user_id=${seat.userId}`,
    );
    await runStatement(
      tx,
      sql`update account_entitlement_grants
      set expires_at = greatest(starts_at, least(expires_at, ${endOfUtcDay(input.now)}))
      where user_id=${seat.userId} and source=${listedWord(entitlementSources, 'organization_seat')} and organization_id=${club.id}`,
    );
    await runStatement(
      tx,
      sql`update users set version=version+1 where id=${seat.userId}`,
    );
  }
  for (const seat of added) {
    const inserted = await query(
      tx,
      z.object({ user_id: z.string() }),
      sql`insert into club_seats
      (organization_id, user_id, assigned_at) values (${club.id}, ${seat.userId}, ${seat.assignedAt})
      on conflict do nothing returning user_id`,
    );
    if (inserted.length !== 1) throw new Refused('seated-elsewhere');
  }
  for (const invitation of opened) {
    await runStatement(
      tx,
      sql`insert into club_seat_invitations
      (id, organization_id, email, invited_by_user_id, expires_at, created_at)
      values (${invitation.id}, ${club.id}, ${invitation.email}, ${input.invitedBy},
        ${invitation.expiresAt}, ${invitation.createdAt})`,
    );
    await queueInvitationMail(tx, {
      organizationId: club.id,
      invitationId: invitation.id,
      sendId: input.nextId(),
    });
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
    /** The application decides resend eligibility while these facts remain fenced. */
    resend(
      subject: ClubSeatSubject,
      organizationId: string,
      invitationId: string,
      decide: (
        facts: ClubInvitationResendFacts,
        mail: () => Promise<ClubInvitationMailFacts>,
      ) => Promise<ClubSeatingRefusal | null>,
    ): Promise<ClubSeatAnswer> {
      if (
        !idSchema.safeParse(organizationId).success ||
        !idSchema.safeParse(invitationId).success
      )
        throw createAppError('VALIDATION');
      return input.run(async (tx): Promise<ClubSeatAnswer> => {
        const { club } = await fenced(tx, subject, organizationId, []);
        if (club.ownerUserId !== subject.userId)
          throw createAppError('NOT_FOUND');
        const plan = await readPlan(tx, club.id);
        const now = await readDatabaseTime(tx);
        const invitations = await readInvitations(tx, club.id);
        let open = true;
        const counts: { pending: Promise<ClubInvitationMailFacts> | null } = {
          pending: null,
        };
        const mail = () => {
          if (!open) throw createAppError('INVARIANT');
          counts.pending ??= readInvitationMailFacts(tx, {
            organizationId: club.id,
            invitationId,
            seatCount: plan.seatCount,
            now,
          });
          return counts.pending;
        };
        let reason: ClubSeatingRefusal | null;
        try {
          reason = await decide(
            {
              evidence: plan.evidence,
              seatCount: plan.seatCount,
              now: now.toISOString(),
              invitation:
                invitations.find(
                  (candidate) => candidate.id === invitationId,
                ) ?? null,
            },
            mail,
          );
          // Detached work cannot outlive the decision or overlap its queue write.
          if (counts.pending) await counts.pending;
        } finally {
          open = false;
        }
        if (reason) return refused(reason);
        await queueInvitationMail(tx, {
          organizationId: club.id,
          invitationId,
          sendId: input.nextId(),
        });
        return { kind: 'changed' };
      });
    },

    /** One manager decision over account-first, Club and billing-fenced facts. */
    managerCommand(
      subject: ClubSeatSubject,
      organizationId: string,
      command: ClubSeatManagerCommand,
      work: (session: {
        readonly load: () => Promise<ClubManagerLoad>;
      }) => Promise<ClubSeatAnswer>,
    ): Promise<ClubSeatAnswer> {
      if (!idSchema.safeParse(organizationId).success || !validCommand(command))
        throw createAppError('VALIDATION');
      const target = targetOf(command);
      return input
        .run(async (tx): Promise<ClubSeatAnswer> => {
          const lifecycle: {
            phase:
              'new' | 'loading' | 'fresh' | 'applying' | 'applied' | 'closed';
          } = { phase: 'new' };
          const phase = () => lifecycle.phase;
          const counts: { pending: Promise<ClubInvitationMailFacts> | null } = {
            pending: null,
          };
          const load = async (): Promise<ClubManagerLoad> => {
            if (phase() !== 'new') throw createAppError('INVARIANT');
            lifecycle.phase = 'loading';
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
            if (phase() !== 'loading') throw createAppError('INVARIANT');
            lifecycle.phase = 'fresh';
            return {
              before,
              ...facts,
              evidence: plan.evidence,
              now: now.toISOString(),
              customer: plan.customer
                ? {
                    mode: plan.customer.mode,
                    vendorCustomerId: plan.customer.vendorCustomerId,
                  }
                : null,
              subscription: plan.subscription
                ? {
                    vendorSubscriptionId:
                      plan.subscription.vendorSubscriptionId,
                  }
                : null,
              mail: () => {
                if (phase() !== 'fresh') throw createAppError('INVARIANT');
                counts.pending ??= readInvitationMailFacts(tx, {
                  organizationId: club.id,
                  invitationId: null,
                  seatCount: plan.seatCount,
                  now,
                });
                return counts.pending;
              },
              apply: async (after) => {
                if (phase() !== 'fresh') throw createAppError('INVARIANT');
                lifecycle.phase = 'applying';
                if (counts.pending) await counts.pending;
                if (phase() !== 'applying') throw createAppError('INVARIANT');
                await writeSeating(tx, {
                  club,
                  before,
                  after,
                  invitedBy: subject.userId,
                  now,
                  nextId: input.nextId,
                });
                await project(tx, club, after.seats);
                if (phase() !== 'applying') throw createAppError('INVARIANT');
                lifecycle.phase = 'applied';
              },
            };
          };
          try {
            const result = await work({ load });
            if (counts.pending) await counts.pending;
            if (
              result.kind === 'refused'
                ? phase() !== 'fresh'
                : phase() !== 'applied'
            )
              throw createAppError('INVARIANT');
            return result;
          } finally {
            lifecycle.phase = 'closed';
          }
        })
        .catch((error: unknown) => {
          if (error instanceof Refused) return refused(error.reason);
          throw error;
        });
    },

    /** Addressed invitee facts and their atomic seat/mail/membership/grant application. */
    answerCommand(
      subject: ClubSeatSubject,
      organizationId: string,
      invitationId: string,
      answer: 'accept' | 'decline',
      work: (session: {
        readonly load: () => Promise<ClubInviteeLoad>;
      }) => Promise<ClubInviteeAnswer>,
    ): Promise<ClubInviteeAnswer> {
      if (
        !idSchema.safeParse(organizationId).success ||
        !idSchema.safeParse(invitationId).success
      )
        throw createAppError('VALIDATION');
      return input
        .run(async (tx): Promise<ClubInviteeAnswer> => {
          const lifecycle: {
            phase:
              'new' | 'loading' | 'fresh' | 'applying' | 'applied' | 'closed';
          } = { phase: 'new' };
          const phase = () => lifecycle.phase;
          const load = async (): Promise<ClubInviteeLoad> => {
            if (phase() !== 'new') throw createAppError('INVARIANT');
            lifecycle.phase = 'loading';
            const { club, seats } = await fenced(
              tx,
              subject,
              organizationId,
              [],
            );
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
            if (phase() !== 'loading') throw createAppError('INVARIANT');
            lifecycle.phase = 'fresh';
            return {
              before,
              now: now.toISOString(),
              elsewhere,
              apply: async (after) => {
                if (phase() !== 'fresh') throw createAppError('INVARIANT');
                lifecycle.phase = 'applying';
                await writeSeating(tx, {
                  club,
                  before,
                  after,
                  invitedBy: subject.userId,
                  now,
                  nextId: input.nextId,
                });
                if (answer === 'accept') {
                  await activateSeatMembership(tx, {
                    organizationId: club.id,
                    userId: subject.userId,
                    now: now.toISOString(),
                  });
                  await project(tx, club, after.seats);
                }
                if (phase() !== 'applying') throw createAppError('INVARIANT');
                lifecycle.phase = 'applied';
              },
            };
          };
          try {
            const result = await work({ load });
            if (
              result.kind === 'refused'
                ? phase() !== 'fresh'
                : phase() !== 'applied'
            )
              throw createAppError('INVARIANT');
            return result;
          } finally {
            lifecycle.phase = 'closed';
          }
        })
        .catch((error: unknown) => {
          if (error instanceof Refused) return refused(error.reason);
          throw error;
        });
    },
  };
}

const refused = (
  reason: ClubSeatingRefusal,
): Extract<ClubSeatAnswer, { kind: 'refused' }> => ({
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
  const rows = await query(
    tx,
    z.object({ id: z.string(), email: z.string(), expires_at: z.date() }),
    sql`select i.id, i.email, i.expires_at
    from club_seat_invitations i, users u
    where i.organization_id=${club.id} and i.id=${invitationId}
      and u.id=${subject.userId} and u.deleted_at is null and u.email_verified
      and ${normalizedEmailSql(sql`u.email`)} = i.email`,
  );
  const [row] = rows;
  return row
    ? {
        id: String(row.id),
        email: normalizeEmail(String(row.email)),
        expiresAt: row.expires_at.toISOString(),
      }
    : null;
}
