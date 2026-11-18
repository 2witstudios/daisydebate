/**
 * The prices /pricing shows, in integer US cents (decisions 78 and 80). The
 * page reads every amount here and never spells one in copy.
 *
 * Premium's amount belongs to billing (`premiumOffer.unitAmount`, PR 791);
 * this module reads it from there once that lands. Club, Host and League
 * prices move to their owning features when S7, S8 and S9 sell them.
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
  premiumMonthlyCents: 2000,
  clubSeatMonthlyCents: 1000,
  host: {
    freeEntryLimit: 16,
    eventUpgrades: [
      { entryLimit: 64, cents: 9900 },
      { entryLimit: null, cents: 19900 },
    ],
  },
};
