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
  const [plans, pricingPage, parentalControls] = await Promise.all([
    requestPlanReleases(),
    requestPricingOpen(),
    requestReleaseEnabled(
      'parental-controls',
      releaseAccountOf(await requestIdentity()),
    ),
  ]);
  return audienceLinks({ ...plans, pricingPage, parentalControls });
};
