import { premiumOffer } from '../billing/premium-price';
import {
  hostingEntryCap,
  hostingOffers,
} from '@daisy/protocol/lobby/hosting-tier';

/**
 * The prices /pricing shows, in integer US cents (decisions 78 and 80). The
 * page reads every amount here and never spells one in copy.
 *
 * Premium's amount is billing's: the offer a new Checkout sells (ADR 0146),
 * read as a named input, so the quote and the charge cannot drift. Host's
 * are the hosting tiers' own (ADR 0149). Club and League prices move to
 * their owning features when S7 and S9 sell them.
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
    freeEntryLimit: hostingEntryCap('free'),
    eventUpgrades: [
      {
        entryLimit: hostingEntryCap('event_64'),
        cents: hostingOffers.event_64.unitAmount,
      },
      {
        entryLimit: hostingEntryCap('event_unlimited'),
        cents: hostingOffers.event_unlimited.unitAmount,
      },
    ],
  },
};
