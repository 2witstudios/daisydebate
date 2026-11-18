/**
 * Each plan's primary action on /pricing. A plan whose destination is not
 * released shows "Coming soon" in place of its button, decided by the
 * release flag that owns that destination.
 */
export type PlanAction =
  | { readonly kind: 'link'; readonly href: string; readonly label: string }
  | { readonly kind: 'coming-soon' };

export type PlanActions = {
  readonly premium: PlanAction;
  readonly club: PlanAction;
  readonly host: PlanAction;
  readonly league: PlanAction;
};

/** Which plans can be started, each from its own release flag. */
export type PlanReleases = {
  /** `premium-checkout`: billing sells Premium. */
  readonly premiumCheckout: boolean;
  /** `daisy-tab`: the host home at /host exists. */
  readonly tabHosting: boolean;
  readonly clubSeats: boolean;
  readonly leagueRequests: boolean;
};

const comingSoon: PlanAction = { kind: 'coming-soon' };

/** Billing holds checkout; its access guard signs a visitor in first. */
const premiumCheckoutHref = '/settings/billing';
const startClubHref = '/clubs/new';
const hostHref = '/host';
const leagueRequestHref = '/contact/league';

export const planActions = (releases: PlanReleases): PlanActions => ({
  premium: releases.premiumCheckout
    ? { kind: 'link', href: premiumCheckoutHref, label: 'Get Premium' }
    : comingSoon,
  club: releases.clubSeats
    ? { kind: 'link', href: startClubHref, label: 'Start a Club' }
    : comingSoon,
  host: releases.tabHosting
    ? { kind: 'link', href: hostHref, label: 'Host a tournament' }
    : comingSoon,
  league: releases.leagueRequests
    ? { kind: 'link', href: leagueRequestHref, label: 'Talk to us' }
    : comingSoon,
});
