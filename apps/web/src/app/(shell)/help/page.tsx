import type { Metadata } from 'next';
import { visibleHelpTopics } from '../../../features/help/topics';
import { requestPricingOpen } from '../pricing/releases';
import { HelpPage } from '../../../ui/help/help-page/help-page';

export const metadata: Metadata = { title: 'Help' };

/**
 * Public: common questions about playing, judging and your data. The plans
 * topic waits for /pricing to open.
 */
export default async function Help() {
  return <HelpPage topics={visibleHelpTopics(await requestPricingOpen())} />;
}
