import { audienceLinks, type AudienceReleases } from './links';

const every = (open: boolean): AudienceReleases => ({
  premiumCheckout: open,
  hostTiers: open,
  clubSeats: open,
  leagueRequests: open,
  pricingPage: open,
  parentalControls: open,
});

/** Every release open, as on staging. */
export const openLinks = audienceLinks(every(true));
/** Every release closed, as on a deployment that has stored none. */
export const closedLinks = audienceLinks(every(false));
