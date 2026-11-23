import type { PlanReleases } from '../../../features/pricing/plan-actions';
import { releaseAccountOf } from '../../../features/flags/release-account';
import {
  requestIdentity,
  requestReleaseEnabled,
} from '../../../lib/request-session';

/**
 * The release reads behind /pricing, in one place: whether the page (and
 * every link to it) is open, and which plans can be started, each for the
 * account `releaseAccountOf` names.
 */
const viewerAccount = async (): Promise<string | null> =>
  releaseAccountOf(await requestIdentity());

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
