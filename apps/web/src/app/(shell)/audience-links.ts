import { releaseAccountOf } from '../../features/flags/release-account';
import { requestReleaseEnabled } from '../../features/flags/page-reads';
import {
  audienceLinks,
  type AudienceLinks,
} from '../../features/marketing/links';
import { requestIdentity } from '../../lib/page-reads';
import { requestPlanReleases, requestPricingOpen } from './pricing/releases';

/**
 * Where the audience pages (`/ncfca`, `/parents`, `/coach`, `/leagues`,
 * `/tab`) may send this viewer: each destination from its own release, read
 * the way /pricing reads them.
 */
export const requestAudienceLinks = async (): Promise<AudienceLinks> => {
  const account = releaseAccountOf(await requestIdentity());
  const [plans, pricingPage, parentalControls, leagueRequests] =
    await Promise.all([
      requestPlanReleases(),
      requestPricingOpen(),
      requestReleaseEnabled('parental-controls', account),
      // /contact/league opens for everyone or no one: it reads no account, so
      // neither does the page that exists to send people there.
      requestReleaseEnabled('league-requests', null),
    ]);
  return audienceLinks({
    ...plans,
    leagueRequests,
    pricingPage,
    parentalControls,
  });
};
