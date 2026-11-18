import type { PlanReleases } from '../../../features/pricing/plan-actions';
import {
  requestIdentity,
  requestReleaseEnabled,
} from '../../../lib/request-session';

/**
 * The release reads behind /pricing, in one place: whether the page (and
 * every link to it) is open, and which plans can be started. Each is read
 * for the viewer's account when they are a member, so an account override
 * (an owner preview, a pilot host) applies; a visitor reads the default.
 */
const viewerAccount = async (): Promise<string | null> => {
  const identity = await requestIdentity();
  return identity.state === 'member' ? identity.principal.userId : null;
};

/** Whether /pricing and the links to it are open for this viewer. */
export const requestPricingOpen = async (): Promise<boolean> =>
  requestReleaseEnabled('pricing-page', await viewerAccount());

/** Each plan's destination, open or not, for this viewer. */
export const requestPlanReleases = async (): Promise<PlanReleases> => {
  const account = await viewerAccount();
  const [premiumCheckout, hostTiers, clubSeats, leagueRequests] =
    await Promise.all([
      requestReleaseEnabled('premium-checkout', account),
      requestReleaseEnabled('host-tiers', account),
      requestReleaseEnabled('club-seats', account),
      requestReleaseEnabled('league-requests', account),
    ]);
  return { premiumCheckout, hostTiers, clubSeats, leagueRequests };
};
