import type { Metadata } from 'next';
import { homeCopy, visibleStories } from '../../../features/guides/library';
import { StoriesPage } from '../../../ui/guides/guide-pages/guide-pages';
import { requestGuideReleases } from '../guides/releases';

export const metadata: Metadata = {
  title: homeCopy.stories.title,
  description: homeCopy.stories.summary,
  alternates: { canonical: '/stories' },
};

/** Public: what is new on Daisy, newest first. */
export default async function Stories() {
  return <StoriesPage stories={visibleStories(await requestGuideReleases())} />;
}
