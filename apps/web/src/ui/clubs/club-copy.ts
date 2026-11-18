import type { ClubSeatingRefusal } from '@daisy/protocol/club-seats';
import type { ClubSeatsView } from '../../features/clubs/views';

type Plan = ClubSeatsView['plan'];
type Club = ClubSeatsView['club'];

/** Every answer a club form can be refused with, as plain copy. */
export type ClubRefusal =
  | ClubSeatingRefusal
  | 'payment-failed'
  | 'released-plan-unchanged'
  | 'unavailable'
  | 'handle-taken'
  | 'not-allowed';

export const refusalCopy: Readonly<Record<ClubRefusal, string>> = {
  'no-free-seat':
    'Every seat is filled or invited. Add seats in Billing, or free one first.',
  'already-invited': 'That email already has an invitation waiting.',
  'invitation-not-found':
    'That invitation is no longer open. It may have been answered or cancelled.',
  'invitation-expired': 'That invitation has expired. Send a new one.',
  'already-seated': 'They already hold a seat in this club.',
  'seated-elsewhere':
    'They already hold a seat in another club. One person can hold one seat.',
  'not-a-member': 'Only members of this club can be given a seat.',
  'not-seated': 'That person no longer holds a seat here.',
  'seat-count-out-of-range': 'Choose between 1 and 200 seats.',
  'choose-released-seats':
    'Choose exactly which seats and invitations to give up before lowering your seats.',
  'unexpected-release':
    'You only give up seats when going below the seats in use.',
  'payment-failed':
    'The payment for the new seats did not go through, so your seats are unchanged. Update your card in Manage payment and try again.',
  'released-plan-unchanged':
    'The seats you chose were given up, but your seat count did not change yet. Try lowering it again.',
  'no-active-plan':
    'Your club plan is not active, so no seats can be given or changed. Renew it in Billing.',
  'resend-too-soon':
    'That invitation was sent within the last hour. Try again later.',
  'invitation-mail-limit':
    'That invitation, or your club today, has sent as many invitations as allowed. Try again tomorrow.',
  unavailable: 'Club billing is unavailable. Try again.',
  'handle-taken': 'A club with that name already exists. Try another name.',
  'not-allowed': 'Your account cannot start a club.',
};

/** The copy for a refusal word from the server; an unknown word reads as unavailable. */
export const refusalText = (reason: unknown): string =>
  typeof reason === 'string' && reason in refusalCopy
    ? refusalCopy[reason as ClubRefusal]
    : refusalCopy.unavailable;

export const clubKindLabel = (kind: Club['kind']) =>
  kind === 'family' ? 'Homeschool family' : 'School club';

/** "$140" for whole dollars, "$9.33" otherwise. */
export function dollars(minor: number) {
  const value = minor / 100;
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
}
/** "$140.00": invoice amounts always carry cents. */
export const cents = (minor: number) =>
  `${minor < 0 ? '−' : ''}$${(Math.abs(minor) / 100).toFixed(2)}`;

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
/** "1 Dec 2026", in UTC like every billing date. */
export const day = (at: string) => dayFormat.format(new Date(at));
/** "1 Dec", in UTC. */
export const shortDay = (at: string) => shortDayFormat.format(new Date(at));

export const ladderLabel = (ladder: 'youth' | 'open' | null) =>
  ladder === 'youth'
    ? 'Youth'
    : ladder === 'open'
      ? 'Open'
      : 'Set when they join';

/** Filled, invited and empty seats, as the boards count them. */
export function seatTally(view: {
  readonly plan: Plan;
  readonly seats: readonly unknown[];
  readonly invitations: readonly { readonly expired: boolean }[];
}) {
  const filled = view.seats.length;
  const invited = view.invitations.filter((i) => !i.expired).length;
  const empty = Math.max(0, view.plan.seatCount - filled - invited);
  return { filled, invited, empty };
}

/** The plan's state in one line, under its price. */
export function planLine(plan: Plan): string {
  switch (plan.state) {
    case 'none':
      return 'Not paid yet';
    case 'active':
      return plan.renewsAt ? `Next invoice ${day(plan.renewsAt)}` : 'Active';
    case 'cancelled':
      return plan.renewsAt
        ? `Cancelled · seats stay Premium until ${day(plan.renewsAt)}`
        : 'Cancelled';
    case 'payment-due':
      return plan.renewsAt
        ? `Payment due · seats stay Premium until ${day(plan.renewsAt)}`
        : 'Payment due';
    case 'ended':
      return 'Ended · seats are on the free plan';
  }
}
