import type { Metadata } from 'next';
import { helpTopics } from '../../../features/help/topics';
import { HelpPage } from '../../../ui/help/help-page/help-page';

export const metadata: Metadata = { title: 'Help' };

/** Public: common questions about playing, judging and your data. */
export default function Help() {
  return <HelpPage topics={helpTopics} />;
}
