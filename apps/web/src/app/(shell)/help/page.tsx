import type { Metadata } from 'next';
import { visibleHelpTopics } from '../../../features/help/topics';
import { readingHomes } from '../../../features/guides/library';
import { requestGuideReleases } from '../guides/releases';
import { requestPricingOpen } from '../pricing/releases';
import { HelpPage } from '../../../ui/help/help-page/help-page';

export const metadata: Metadata = { title: 'Help' };

/**
 * Public: the way into Guides, Learn and Stories, then common questions
 * about playing, judging and your data. The plans topic waits for /pricing
 * to open.
 */
export default async function Help() {
  const [pricingOpen, releases] = await Promise.all([
    requestPricingOpen(),
    requestGuideReleases(),
  ]);
  return (
    <HelpPage
      homes={readingHomes(releases)}
      topics={visibleHelpTopics(pricingOpen)}
    />
  );
}
