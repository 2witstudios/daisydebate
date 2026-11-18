import type { Metadata } from 'next';
import { helpTopics, pricingTopicId } from '../../../features/help/topics';
import { requestReleaseEnabled } from '../../../lib/request-session';
import { HelpPage } from '../../../ui/help/help-page/help-page';

export const metadata: Metadata = { title: 'Help' };

/**
 * Public: common questions about playing, judging and your data. The plans
 * topic waits for /pricing to open.
 */
export default async function Help() {
  const pricing = await requestReleaseEnabled('pricing-page', null);
  return (
    <HelpPage
      topics={
        pricing
          ? helpTopics
          : helpTopics.filter((topic) => topic.id !== pricingTopicId)
      }
    />
  );
}
