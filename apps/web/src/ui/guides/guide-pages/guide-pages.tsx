import Link from 'next/link';
import type {
  Article,
  Collection,
  Home,
} from '../../../features/guides/article';
import {
  articleHref,
  collectionHref,
  homeCopy,
} from '../../../features/guides/library';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ArticleBlocks } from '../article-blocks/article-blocks';
import {
  ArticleList,
  type ArticleListItem,
} from '../article-list/article-list';

type Crumb = { readonly href: string; readonly label: string };

const homeHref = (home: Home) => `/${home}`;

function Breadcrumbs({ crumbs }: { readonly crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap gap-x-2 text-sm text-ink-muted">
        {crumbs.map((crumb, index) => (
          <li key={crumb.href} className="flex gap-2">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            <Link href={crumb.href}>{crumb.label}</Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const itemOf = (article: Article): ArticleListItem => ({
  href: articleHref(article),
  title: article.title,
  summary: article.summary,
});

const helpCrumb: Crumb = { href: '/help', label: 'Help' };

/** /guides or /learn: each collection, with its articles. */
export function HomeShelfPage({
  home,
  shelves,
}: {
  readonly home: Exclude<Home, 'stories'>;
  readonly shelves: readonly {
    readonly collection: Collection;
    readonly articles: readonly Article[];
  }[];
}) {
  return (
    <ReadingPage>
      <Breadcrumbs crumbs={[helpCrumb]} />
      <PageHeader title={homeCopy[home].title} lede={homeCopy[home].summary} />
      {shelves.map(({ collection, articles }) => (
        <section
          key={collection.slug}
          aria-labelledby={`shelf-${collection.slug}`}
          className="flex flex-col gap-3"
        >
          <h2
            id={`shelf-${collection.slug}`}
            className="font-display text-xl font-bold"
          >
            <Link href={collectionHref(collection)}>{collection.title}</Link>
          </h2>
          <p className="text-base text-ink-muted">{collection.summary}</p>
          <ArticleList label={collection.title} items={articles.map(itemOf)} />
        </section>
      ))}
    </ReadingPage>
  );
}

/** One collection's articles, in reading order. */
export function CollectionPage({
  collection,
  articles,
}: {
  readonly collection: Collection;
  readonly articles: readonly Article[];
}) {
  return (
    <ReadingPage>
      <Breadcrumbs
        crumbs={[
          helpCrumb,
          {
            href: homeHref(collection.home),
            label: homeCopy[collection.home].title,
          },
        ]}
      />
      <PageHeader title={collection.title} lede={collection.summary} />
      <ArticleList label={collection.title} items={articles.map(itemOf)} />
    </ReadingPage>
  );
}

/** One article, with what to read next. */
export function ArticlePage({
  article,
  collection,
  related,
}: {
  readonly article: Article;
  readonly collection: Collection;
  readonly related: readonly Article[];
}) {
  const crumbs: Crumb[] = [
    helpCrumb,
    { href: homeHref(article.home), label: homeCopy[article.home].title },
    ...(article.home === 'stories'
      ? []
      : [{ href: collectionHref(collection), label: collection.title }]),
  ];
  return (
    <ReadingPage>
      <Breadcrumbs crumbs={crumbs} />
      <article className="flex flex-col gap-6">
        <PageHeader title={article.title} lede={article.summary} />
        <ArticleBlocks blocks={article.blocks} />
        <p className="text-sm text-ink-muted">
          Updated <time dateTime={article.updated}>{article.updated}</time>
        </p>
      </article>
      {related.length > 0 ? (
        <section aria-labelledby="read-next" className="flex flex-col gap-3">
          <h2 id="read-next" className="font-display text-xl font-bold">
            Read next
          </h2>
          <ArticleList label="Read next" items={related.map(itemOf)} />
        </section>
      ) : null}
    </ReadingPage>
  );
}

/** /stories: what is new, newest first. */
export function StoriesPage({
  stories,
}: {
  readonly stories: readonly Article[];
}) {
  return (
    <ReadingPage>
      <Breadcrumbs crumbs={[helpCrumb]} />
      <PageHeader
        title={homeCopy.stories.title}
        lede={homeCopy.stories.summary}
      />
      {stories.length > 0 ? (
        <ArticleList label="Stories" items={stories.map(itemOf)} />
      ) : (
        <p className="text-base text-ink-muted">Nothing published yet.</p>
      )}
    </ReadingPage>
  );
}
