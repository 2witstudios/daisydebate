import type {
  HostingTier,
  PaidHostingTier,
} from '@daisy/protocol/lobby/hosting-tier';

/** "$99" from whole-dollar cents, "$99.50" otherwise; "$99.00" when `exact`. */
export const formatUsd = (cents: number, exact = false) => {
  const dollars = cents / 100;
  return `$${exact || !Number.isInteger(dollars) ? dollars.toFixed(2) : dollars}`;
};

/** How the host home and rail name a tournament's hosting. */
export const hostingTierWords: Record<HostingTier, string> = {
  free: 'free hosting',
  event_64: 'up to 64 entries',
  event_unlimited: 'unlimited entries',
};

/** A paid tier as its upgrade card and receipts name it. */
export const paidTierTitle: Record<PaidHostingTier, string> = {
  event_64: 'Up to 64 entries',
  event_unlimited: 'Unlimited entries',
};

/** "16 of 16 entries", or "38 entries" where there is no cap. */
export const entriesOfCap = (accepted: number, cap: number | null) =>
  cap === null
    ? `${accepted} ${accepted === 1 ? 'entry' : 'entries'}`
    : `${accepted} of ${cap} entries`;

const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "17 Nov 2026" in UTC. */
export const hostingDate = (iso: string) => {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};
