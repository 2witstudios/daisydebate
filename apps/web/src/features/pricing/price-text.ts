import type { HostEventUpgrade } from './plan-prices';

/**
 * Pure price wording for /pricing. Amounts are integer US cents; whole
 * dollars drop the cents ("$20"), anything else keeps two places ("$20.50").
 */
export const formatUsd = (cents: number): string => {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new RangeError(`Not a price in cents: ${cents}`);
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  const whole = dollars.toLocaleString('en-US');
  return rest === 0
    ? `$${whole}`
    : `$${whole}.${String(rest).padStart(2, '0')}`;
};

/** The period beside a monthly price: "a month". */
export const monthlyPeriodText = 'a month';

/** The period beside a per-seat price: "per seat, a month". */
export const perSeatPeriodText = 'per seat, a month';

/** A Host event tier's name: "Up to 64 entries" or "Unlimited entries". */
export const entryLimitText = (entryLimit: number | null): string =>
  entryLimit === null ? 'Unlimited entries' : `Up to ${entryLimit} entries`;

/** A Host event tier in running prose: "$99 up to 64 entries", "$199 unlimited". */
export const eventUpgradeText = (upgrade: HostEventUpgrade): string =>
  `${formatUsd(upgrade.cents)} ${
    upgrade.entryLimit === null
      ? 'unlimited'
      : `up to ${upgrade.entryLimit} entries`
  }`;
