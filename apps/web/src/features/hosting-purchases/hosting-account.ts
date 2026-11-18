import {
  hostingEntryCap,
  hostingUpgrade,
  paidHostingTiers,
  type HostingTier,
  type PaidHostingTier,
} from '@daisy/protocol/lobby/hosting-tier';
import type { TournamentHostingAccount } from '@daisy/db/tab';
import { tournamentHostingTier } from '../tab/hosting-tier';

/** One way up from the tier held, and what it still costs (USD cents). */
export type HostingUpgradeOption = {
  readonly tier: PaidHostingTier;
  readonly owed: number;
};

/** A payment as the event's Billing lists it. Card details are never stored. */
export type HostingPaymentView = {
  readonly id: string;
  readonly at: string;
  readonly tier: PaidHostingTier;
  readonly payerName: string;
  readonly amount: number;
  readonly state: 'paid' | 'open' | 'expired';
  readonly receiptUrl: string | null;
};

/** What the upgrade and Billing pages show a host of one tournament. */
export type HostingAccountView = {
  readonly lobbyId: string;
  readonly handle: string;
  readonly name: string;
  readonly tier: HostingTier;
  /** Covered by a league or an administrative grant, so never sold. */
  readonly covered: boolean;
  readonly entryCap: number | null;
  readonly acceptedEntries: number;
  readonly waitingEntries: number;
  readonly upgrades: readonly HostingUpgradeOption[];
  readonly payments: readonly HostingPaymentView[];
  /** The payment that set the current paid tier. */
  readonly settled: HostingPaymentView | null;
};

export function hostingAccountView(
  account: TournamentHostingAccount,
  now: string,
): HostingAccountView {
  const tier = tournamentHostingTier(account.hosting, now);
  const paidTier = tournamentHostingTier(
    { ...account.hosting, ownerOrganizationId: null, ownerHosting: null },
    now,
  );
  const covered = tier !== paidTier;
  const payments = account.purchases.map((purchase): HostingPaymentView => ({
    id: purchase.id,
    at: purchase.paidAt ?? purchase.createdAt,
    tier: purchase.tier,
    payerName: purchase.payerName,
    amount: purchase.amount,
    state: purchase.state,
    receiptUrl: purchase.receiptUrl,
  }));
  return {
    lobbyId: account.lobby.id,
    handle: account.lobby.handle,
    name: account.lobby.name,
    tier,
    covered,
    entryCap: hostingEntryCap(tier),
    acceptedEntries: account.acceptedEntries,
    waitingEntries: account.waitingEntries,
    upgrades: covered
      ? []
      : paidHostingTiers.flatMap((target) => {
          const upgrade = hostingUpgrade(tier, target);
          return upgrade.kind === 'owed'
            ? [{ tier: target, owed: upgrade.amount }]
            : [];
        }),
    payments,
    settled:
      payments
        .filter((payment) => payment.state === 'paid' && payment.tier === tier)
        .at(-1) ?? null,
  };
}
