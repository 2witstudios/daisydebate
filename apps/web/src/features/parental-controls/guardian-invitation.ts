import type { AgeBand } from '@daisy/protocol';
import type { GuardianRefusal } from '@daisy/protocol/guardians';
import { ageBand } from '@daisy/auth';

/**
 * A parent creating their child's account (ADR 0163, decision 93). It is
 * not a second account system: Daisy stores the parent's invitation and
 * emails the child better-auth's ordinary sign-in link. The account is
 * created by that sign-in, and the invitation is claimed at the child's age
 * step. The parent never learns whether the address already had an account
 * (point guard, 2026-11-19): an existing child's account is asked to confirm
 * the parent instead, and anyone else is told nothing changed.
 */

/** How long an invitation can be claimed. */
const INVITATION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export const invitationExpiresAt = (createdAt: string): string =>
  new Date(Date.parse(createdAt) + INVITATION_DAYS * DAY_MS).toISOString();

const invitationLive = (
  invitation: { readonly status: string; readonly expiresAt: string },
  now: string,
): boolean =>
  invitation.status === 'open' &&
  Date.parse(invitation.expiresAt) > Date.parse(now);

/** Who already holds the address the parent typed, as the server alone knows it. */
type AddressHolder =
  | { readonly kind: 'nobody' }
  | {
      readonly kind: 'account';
      readonly userId: string;
      /** Null when the account has no recorded age yet. */
      readonly ageBand: AgeBand | null;
      /** Whether this parent already has an open or active link to it. */
      readonly linkedToParent: boolean;
    };

export type ChildAccountFacts = {
  readonly now: string;
  readonly parent: {
    readonly userId: string;
    readonly email: string;
    readonly ageBand: AgeBand | null;
  };
  /** Whether this parent already has a live invitation to this address. */
  readonly parentInvitedAddress: boolean;
  readonly holder: AddressHolder;
};

/**
 * What creating a child's account does. Every accepted outcome tells the
 * parent the same thing ("we emailed <address>"); the difference is only in
 * what the server writes and which email it sends.
 */
export type ChildAccountDecision =
  | { readonly kind: 'refused'; readonly refusal: GuardianRefusal }
  /** Nobody holds the address: store the invitation and send the sign-in link. */
  | { readonly kind: 'invite' }
  /** A minor's account holds it: ask that account to confirm the parent. */
  | { readonly kind: 'ask-existing'; readonly minorUserId: string }
  /** The address is held, but a new link request would change nothing. */
  | { readonly kind: 'tell-holder' };

const isMinor = (band: AgeBand | null): boolean =>
  band === '13-15' || band === '16-17';

export function decideChildAccount(
  facts: ChildAccountFacts,
  command: { readonly birthMonth: string; readonly email: string },
): ChildAccountDecision {
  if (facts.parent.ageBand !== 'adult')
    return { kind: 'refused', refusal: 'not-an-adult' };
  const band = childBand(command.birthMonth, facts.now);
  if (band !== 'minor') return { kind: 'refused', refusal: band };
  if (command.email === facts.parent.email)
    return { kind: 'refused', refusal: 'own-email' };
  if (facts.parentInvitedAddress)
    return { kind: 'refused', refusal: 'already-linked' };
  const holder = facts.holder;
  if (holder.kind === 'nobody') return { kind: 'invite' };
  if (holder.userId === facts.parent.userId)
    return { kind: 'refused', refusal: 'own-email' };
  return isMinor(holder.ageBand) && !holder.linkedToParent
    ? { kind: 'ask-existing', minorUserId: holder.userId }
    : { kind: 'tell-holder' };
}

/** A birth month the parent gives: 13 to 17 today, or why not. */
export function childBand(
  birthMonth: string,
  now: string,
): 'minor' | 'under-13' | 'not-a-minor' {
  const band = ageBand(birthMonth, new Date(now));
  if (band === 'under-13') return 'under-13';
  return band === 'adult' ? 'not-a-minor' : 'minor';
}

/** A live invitation addressed to the child's verified email. */
export type ClaimableInvitation = {
  readonly id: string;
  readonly guardianUserId: string;
  readonly guardianConsentId: string;
  readonly birthMonth: string;
  readonly createdAt: string;
  readonly status: string;
  readonly expiresAt: string;
  /** Whether the inviting parent is admitted to the beta now. */
  readonly guardianAdmitted: boolean;
};

export type InvitationClaim = {
  /** The parent whose invitation made the account, and whose link starts active. */
  readonly created: ClaimableInvitation;
  /** The birth month the account records: that parent's, binding. */
  readonly birthMonth: string;
  /** Other parents who invited the same address: asked, as for any existing account. */
  readonly asked: readonly ClaimableInvitation[];
  /** The child joins the beta with their parent (point guard, Q1). */
  readonly admitted: boolean;
};

/**
 * At the child's first age step: the earliest live invitation to their
 * address made the account. Null when none is live or its birth month is no
 * longer a minor's, so the child onboards like anyone else.
 */
export function claimInvitations(
  invitations: readonly ClaimableInvitation[],
  now: string,
): InvitationClaim | null {
  const live = invitations
    .filter((invitation) => invitationLive(invitation, now))
    .filter((invitation) => childBand(invitation.birthMonth, now) === 'minor')
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        (a.id < b.id ? -1 : 1),
    );
  const [created, ...asked] = live;
  if (!created) return null;
  return {
    created,
    birthMonth: created.birthMonth,
    asked,
    admitted: created.guardianAdmitted,
  };
}
