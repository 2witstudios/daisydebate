import type { ReleaseFlagKey } from '../flags/catalogue';
import {
  homes,
  type Article,
  type ArticleRef,
  type Collection,
  type Home,
} from './article';
import {
  judgingAndFeedbackArticles,
  judgingAndFeedbackCollection,
} from './content/judging-and-feedback';
import { judgingArticles, judgingCollection } from './content/judging';

/** Stories are one flat feed; this is the collection each story sits in. */
export const storiesCollection: Collection = {
  home: 'stories',
  slug: 'updates',
  title: 'Stories and updates',
  summary: 'What is new on Daisy, and articles worth reading.',
};

/** Every collection, in the order each home lists them. */
export const collections: readonly Collection[] = [
  judgingCollection,
  judgingAndFeedbackCollection,
  storiesCollection,
];

/** Every article, in the order its collection lists them. */
export const articles: readonly Article[] = [
  ...judgingArticles,
  ...judgingAndFeedbackArticles,
];

/** What each home is called, and what it is for. */
export const homeCopy: Readonly<
  Record<Home, { readonly title: string; readonly summary: string }>
> = {
  guides: {
    title: 'Guides',
    summary: 'How to use Daisy, task by task.',
  },
  learn: {
    title: 'Learn debate',
    summary: 'Build your debating and judging skills.',
  },
  stories: {
    title: 'Stories and updates',
    summary: 'What is new on Daisy, and articles worth reading.',
  },
};

export const articleRef = (article: Article): ArticleRef =>
  `${article.home}/${article.collection}/${article.slug}`;

/** An article's path: Stories are flat, Guides and Learn sit in a collection. */
export const articleHref = (article: Article): string =>
  article.home === 'stories'
    ? `/stories/${article.slug}`
    : `/${article.home}/${article.collection}/${article.slug}`;

export const collectionHref = (collection: Collection): string =>
  `/${collection.home}/${collection.slug}`;

export const articleByRef = (ref: string): Article | undefined =>
  articles.find((article) => articleRef(article) === ref);

export const collectionOf = (article: Article): Collection | undefined =>
  collections.find(
    (collection) =>
      collection.home === article.home &&
      collection.slug === article.collection,
  );

/** The release flags any article or collection waits on, each once. */
export const releaseKeys: readonly ReleaseFlagKey[] = [
  ...new Set(
    [...collections, ...articles].flatMap((entry) =>
      entry.release ? [entry.release] : [],
    ),
  ),
];

/** The releases open for one viewer. */
export type OpenReleases = ReadonlySet<ReleaseFlagKey>;

const open = (release: ReleaseFlagKey | undefined, releases: OpenReleases) =>
  release === undefined || releases.has(release);

/**
 * What one viewer may read: a collection waits on its release, and an
 * article on its own and its collection's, like the feature it explains.
 */
const visibleCollection = (
  collection: Collection,
  releases: OpenReleases,
): boolean => open(collection.release, releases);

export const visibleArticle = (
  article: Article,
  releases: OpenReleases,
): boolean => {
  const collection = collectionOf(article);
  return (
    collection !== undefined &&
    visibleCollection(collection, releases) &&
    open(article.release, releases)
  );
};

/** A home's collections this viewer can read, each with its articles. */
export const homeShelf = (home: Home, releases: OpenReleases) =>
  collections
    .filter(
      (collection) =>
        collection.home === home && visibleCollection(collection, releases),
    )
    .map((collection) => ({
      collection,
      articles: articlesIn(collection, releases),
    }))
    .filter((shelf) => shelf.articles.length > 0);

export const articlesIn = (
  collection: Collection,
  releases: OpenReleases,
): readonly Article[] =>
  articles.filter(
    (article) =>
      article.home === collection.home &&
      article.collection === collection.slug &&
      visibleArticle(article, releases),
  );

/**
 * One collection, if this viewer may read it and at least one of its
 * articles: a collection with nothing visible is not found, as on its home.
 */
export const findCollection = (
  home: Home,
  slug: string,
  releases: OpenReleases,
): Collection | undefined =>
  collections.find(
    (collection) =>
      collection.home === home &&
      collection.slug === slug &&
      visibleCollection(collection, releases) &&
      articlesIn(collection, releases).length > 0,
  );

/** One article, if this viewer may read it. */
export const findArticle = (
  home: Home,
  collection: string,
  slug: string,
  releases: OpenReleases,
): Article | undefined =>
  articles.find(
    (article) =>
      article.home === home &&
      article.collection === collection &&
      article.slug === slug &&
      visibleArticle(article, releases),
  );

/** The stories this viewer can read, most recently published first. */
export const visibleStories = (releases: OpenReleases): readonly Article[] =>
  [
    ...articles.filter(
      (article) =>
        article.home === 'stories' && visibleArticle(article, releases),
    ),
  ].sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''));

/** An article's related reading this viewer can open. */
export const relatedArticles = (
  article: Article,
  releases: OpenReleases,
): readonly Article[] =>
  article.related.flatMap((ref) => {
    const related = articleByRef(ref);
    return related && visibleArticle(related, releases) ? [related] : [];
  });

/** The homes with something this viewer can read, as Help lists them. */
export const readingHomes = (releases: OpenReleases) =>
  homes
    .filter((home) =>
      home === 'stories'
        ? visibleStories(releases).length > 0
        : homeShelf(home, releases).length > 0,
    )
    .map((home) => ({
      href: `/${home}`,
      title: homeCopy[home].title,
      summary: homeCopy[home].summary,
    }));
