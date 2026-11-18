/**
 * Each plan's primary action on /pricing. A plan whose route has not shipped
 * shows "Coming soon" in place of its button, decided by its release flag.
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

/** Which not-yet-shipped plans are open, from their release flags. */
export type PlanReleases = {
  readonly clubSeats: boolean;
  readonly leagueRequests: boolean;
};

/** Billing holds checkout; its access guard signs a visitor in first. */
export const premiumCheckoutHref = '/settings/billing';
export const startClubHref = '/clubs/new';
export const hostHref = '/host';
export const leagueRequestHref = '/contact/league';

export const planActions = (releases: PlanReleases): PlanActions => ({
  premium: { kind: 'link', href: premiumCheckoutHref, label: 'Get Premium' },
  club: releases.clubSeats
    ? { kind: 'link', href: startClubHref, label: 'Start a Club' }
    : { kind: 'coming-soon' },
  host: { kind: 'link', href: hostHref, label: 'Host a tournament' },
  league: releases.leagueRequests
    ? { kind: 'link', href: leagueRequestHref, label: 'Talk to us' }
    : { kind: 'coming-soon' },
});
