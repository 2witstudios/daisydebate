import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  findArticle,
  relatedArticles,
  storiesCollection,
} from '../../../../features/guides/library';
import { ArticlePage } from '../../../../ui/guides/guide-pages/guide-pages';
import { requestGuideReleases } from '../../guides/releases';

type Params = { readonly params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const story = findArticle(
    'stories',
    storiesCollection.slug,
    slug,
    await requestGuideReleases(),
  );
  return story ? { title: story.title, description: story.summary } : {};
}

/** Public: one story; a story whose release is closed is not found. */
export default async function Story({ params }: Params) {
  const { slug } = await params;
  const releases = await requestGuideReleases();
  const story = findArticle('stories', storiesCollection.slug, slug, releases);
  if (!story) notFound();
  return (
    <ArticlePage
      article={story}
      collection={storiesCollection}
      related={relatedArticles(story, releases)}
    />
  );
}
