import { premiumOffer } from '../billing/premium-price';

/**
 * The prices /pricing shows, in integer US cents (decisions 78 and 80). The
 * page reads every amount here and never spells one in copy.
 *
 * Premium's amount is billing's: the offer a new Checkout sells (ADR 0146),
 * read as a named input, so the quote and the charge cannot drift. Club,
 * Host and League prices move to their owning features when S7, S8 and S9
 * sell them.
 */
export type HostEventUpgrade = {
  /** The most entries the event may take; null is unlimited. */
  readonly entryLimit: number | null;
  readonly cents: number;
};

export type PlanPrices = {
  readonly premiumMonthlyCents: number;
  readonly clubSeatMonthlyCents: number;
  readonly host: {
    readonly freeEntryLimit: number;
    /** One-off upgrades for one event, smallest first. */
    readonly eventUpgrades: readonly HostEventUpgrade[];
  };
};

export const planPrices: PlanPrices = {
  premiumMonthlyCents: premiumOffer.unitAmount,
  clubSeatMonthlyCents: 1000,
  host: {
    freeEntryLimit: 16,
    eventUpgrades: [
      { entryLimit: 64, cents: 9900 },
      { entryLimit: null, cents: 19900 },
    ],
  },
};
