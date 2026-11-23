import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Home } from '../../../features/guides/article';
import {
  articlesIn,
  collectionOf,
  findArticle,
  findCollection,
  homeCopy,
  homeShelf,
  relatedArticles,
} from '../../../features/guides/library';
import {
  ArticlePage,
  CollectionPage,
  HomeShelfPage,
} from '../../../ui/guides/guide-pages/guide-pages';
import { requestGuideReleases } from './releases';

type Shelved = Exclude<Home, 'stories'>;

/** /guides and /learn: each home's collections. */
export const homeRoute = (home: Shelved) => ({
  metadata: {
    title: homeCopy[home].title,
    description: homeCopy[home].summary,
    alternates: { canonical: `/${home}` },
  } satisfies Metadata,
  Page: async function HomeRoute() {
    return (
      <HomeShelfPage
        home={home}
        shelves={homeShelf(home, await requestGuideReleases())}
      />
    );
  },
});

type CollectionParams = {
  readonly params: Promise<{ collection: string }>;
};

/** One collection; a collection whose release is closed is not found. */
export const collectionRoute = (home: Shelved) => ({
  generateMetadata: async ({ params }: CollectionParams): Promise<Metadata> => {
    const { collection: slug } = await params;
    const collection = findCollection(home, slug, await requestGuideReleases());
    return collection
      ? { title: collection.title, description: collection.summary }
      : {};
  },
  Page: async function CollectionRoute({ params }: CollectionParams) {
    const { collection: slug } = await params;
    const releases = await requestGuideReleases();
    const collection = findCollection(home, slug, releases);
    if (!collection) notFound();
    return (
      <CollectionPage
        collection={collection}
        articles={articlesIn(collection, releases)}
      />
    );
  },
});

type ArticleParams = {
  readonly params: Promise<{ collection: string; slug: string }>;
};

/** One article; an article whose release is closed is not found. */
export const articleRoute = (home: Shelved) => ({
  generateMetadata: async ({ params }: ArticleParams): Promise<Metadata> => {
    const { collection, slug } = await params;
    const article = findArticle(
      home,
      collection,
      slug,
      await requestGuideReleases(),
    );
    return article
      ? { title: article.title, description: article.summary }
      : {};
  },
  Page: async function ArticleRoute({ params }: ArticleParams) {
    const { collection, slug } = await params;
    const releases = await requestGuideReleases();
    const article = findArticle(home, collection, slug, releases);
    const shelf = article && collectionOf(article);
    if (!article || !shelf) notFound();
    return (
      <ArticlePage
        article={article}
        collection={shelf}
        related={relatedArticles(article, releases)}
      />
    );
  },
});
