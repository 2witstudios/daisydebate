import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { routeExists } from '../../ui/test-support/route-exists';
import { homes, type Article, type Block } from './article';
import {
  articleByRef,
  articleHref,
  articleRef,
  articles,
  collectionHref,
  collectionOf,
  collections,
  findArticle,
  findCollection,
  homeShelf,
  relatedArticles,
  visibleArticle,
} from './library';
import { guideEntryLinks } from './entry-links';
import { proseLinks, proseRuns } from './prose';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../app');
const repositoryRoot = join(import.meta.dir, '../../../../..');
const none = new Set<never>();

const blockProse = (block: Block): readonly string[] => {
  switch (block.kind) {
    case 'paragraph':
    case 'note':
      return [block.text];
    case 'steps':
    case 'list':
      return block.items;
    case 'terms':
      return block.items.map((item) => item.detail);
    case 'heading':
    case 'example':
      return [];
  }
};

const linksOf = (article: Article): readonly string[] =>
  article.blocks.flatMap(blockProse).flatMap(proseLinks);

/**
 * Reading paths resolve only to what exists: every `[param]` route under
 * them matches any segment, so they are checked against the library itself.
 */
const readingPaths = new Set([
  ...articles.map(articleHref),
  // Stories are a flat feed: their collection has no page of its own.
  ...collections
    .filter((collection) => collection.home !== 'stories')
    .map(collectionHref),
  ...homes.map((home) => `/${home}`),
]);
const isReadingPath = (path: string) =>
  homes.some((home) => path === `/${home}` || path.startsWith(`/${home}/`));
const resolves = (href: string): boolean => {
  const path = href.split('#')[0]?.split('?')[0] ?? '';
  return isReadingPath(path)
    ? readingPaths.has(path)
    : routeExists(appDirectory, path);
};

describe('the article graph', () => {
  test('every article is addressable once', () => {
    assert({
      given: 'every article',
      should: 'have a unique reference and belong to a collection of its home',
      actual: [
        new Set(articles.map(articleRef)).size === articles.length,
        articles.filter((article) => collectionOf(article) === undefined),
        new Set(collections.map((c) => `${c.home}/${c.slug}`)).size ===
          collections.length,
      ],
      expected: [true, [], true],
    });
  });

  test('related reading resolves', () => {
    assert({
      given: 'every related reference',
      should: 'name an existing article other than itself',
      actual: articles.flatMap((article) =>
        article.related
          .filter(
            (ref) =>
              articleByRef(ref) === undefined || ref === articleRef(article),
          )
          .map((ref) => `${articleRef(article)} → ${ref}`),
      ),
      expected: [],
    });
  });

  test('every link in the copy reaches a page', () => {
    assert({
      given: 'every link written in an article',
      should: 'resolve to an article or an app route',
      actual: articles.flatMap((article) =>
        linksOf(article)
          .filter((href) => !resolves(href))
          .map((href) => `${articleRef(article)} → ${href}`),
      ),
      expected: [],
    });
  });

  test('a reading path must name a real article', () => {
    assert({
      given:
        'a missing guide, a missing Learn article, the Stories collection, a real guide and an app route',
      should: 'resolve only the real guide and the app route',
      actual: [
        resolves('/guides/judging/no-such-guide'),
        resolves('/learn/anything/at-all'),
        resolves('/stories/updates'),
        resolves('/guides/judging/understanding-a-ballot#who-reads'),
        resolves('/judge'),
      ],
      expected: [false, false, false, true, true],
    });
  });

  test('the product links into real guides', () => {
    assert({
      given: 'every link the product makes into the guides',
      should: 'name a collection or article that exists',
      actual: Object.values(guideEntryLinks).filter((href) => !resolves(href)),
      expected: [],
    });
  });

  test('an article links only to what its readers can open', () => {
    const releasesOf = (article: Article) =>
      new Set(
        [article.release, collectionOf(article)?.release].filter(
          (release) => release !== undefined,
        ),
      );
    const blockedFor = (article: Article) => (href: string) => {
      const path = href.split('#')[0];
      const releases = releasesOf(article);
      const target = articles.find((entry) => articleHref(entry) === path);
      if (target) return !visibleArticle(target, releases);
      const shelf = collections.find((entry) => collectionHref(entry) === path);
      return (
        shelf !== undefined &&
        findCollection(shelf.home, shelf.slug, releases) === undefined
      );
    };
    assert({
      given: 'every link from one article to another article or a collection',
      should:
        'reach a page visible wherever the linking article is, never one behind a release it does not share',
      actual: articles.flatMap((article) =>
        linksOf(article)
          .filter(blockedFor(article))
          .map((href) => `${articleRef(article)} → ${href}`),
      ),
      expected: [],
    });
  });

  test('no copy is a malformed link', () => {
    assert({
      given: 'every piece of article copy',
      should: 'leave no text that still looks like markdown link syntax',
      actual: articles.flatMap((article) =>
        article.blocks
          .flatMap(blockProse)
          .flatMap(proseRuns)
          .filter((run) => run.kind === 'text' && run.text.includes(']('))
          .map(() => articleRef(article)),
      ),
      expected: [],
    });
  });

  test('every story has a publication day', () => {
    assert({
      given: 'every story',
      should: 'carry the day it was published, which the feed sorts on',
      actual: articles
        .filter((article) => article.home === 'stories' && !article.published)
        .map(articleRef),
      expected: [],
    });
  });

  test('every cited source exists', () => {
    assert({
      given: 'every source path an article was checked against',
      should: 'exist in the repository, and every Guide cites at least one',
      actual: [
        articles.flatMap((article) =>
          article.sources
            .filter((path) => !existsSync(join(repositoryRoot, path)))
            .map((path) => `${articleRef(article)} → ${path}`),
        ),
        articles
          .filter(
            (article) =>
              article.home === 'guides' && article.sources.length === 0,
          )
          .map(articleRef),
      ],
      expected: [[], []],
    });
  });

  test('every article is reachable from another', () => {
    const linked = new Set(
      articles.flatMap((article) => [...article.related, ...linksOf(article)]),
    );
    assert({
      given: 'every article',
      should: 'be linked from at least one other article',
      actual: articles
        .filter(
          (article) =>
            !linked.has(articleRef(article)) &&
            !linked.has(articleHref(article)),
        )
        .map(articleRef),
      expected: [],
    });
  });

  test('Learn and Guides meet', () => {
    const learning = articles.filter(
      (article) =>
        article.home === 'learn' &&
        article.collection === 'judging-and-feedback',
    );
    const guideLinks = new Set(
      articles
        .filter((article) => article.home === 'guides')
        .flatMap((article) => [...article.related, ...linksOf(article)]),
    );
    assert({
      given: 'each judging Learn article',
      should: 'link to a Guide, and be linked from one',
      actual: learning
        .filter(
          (article) =>
            ![...article.related, ...linksOf(article)].some(
              (link) =>
                link.startsWith('guides/') || link.startsWith('/guides/'),
            ) ||
            !(
              guideLinks.has(articleRef(article)) ||
              guideLinks.has(articleHref(article))
            ),
        )
        .map(articleRef),
      expected: [],
    });
  });
});

describe('visibility', () => {
  const flagged: Article = {
    home: 'guides',
    collection: 'judging',
    slug: 'flagged',
    title: 'Flagged',
    summary: 'A guide for a feature in early access.',
    updated: '2026-11-23',
    blocks: [],
    related: [],
    sources: [],
    release: 'daisy-tab',
  };

  test('an article follows its release', () => {
    assert({
      given:
        'an article waiting on a release, with the release closed and open',
      should: 'be hidden, then shown',
      actual: [
        visibleArticle(flagged, none),
        visibleArticle(flagged, new Set(['daisy-tab'] as const)),
      ],
      expected: [false, true],
    });
  });

  test('the pilot is public', () => {
    assert({
      given: 'no open releases',
      should:
        'show the judging Guides and Learn shelves and find a judging article',
      actual: [
        homeShelf('guides', none).map((shelf) => shelf.collection.slug),
        homeShelf('learn', none).map((shelf) => shelf.collection.slug),
        findArticle('guides', 'judging', 'understanding-a-ballot', none)?.title,
        findArticle('guides', 'judging', 'nope', none),
      ],
      expected: [
        ['judging'],
        ['judging-and-feedback'],
        'Understanding a Daisy ballot',
        undefined,
      ],
    });
  });

  test('a collection with nothing to read is not found', () => {
    assert({
      given: 'the Stories collection, which has no stories yet',
      should: 'not be found, as it is not listed on its home',
      actual: findCollection('stories', 'updates', none),
      expected: undefined,
    });
  });

  test('related reading skips what a viewer cannot open', () => {
    const article = articles[0];
    assert({
      given: 'an article with related reading',
      should: 'list only visible articles',
      actual:
        article === undefined
          ? false
          : relatedArticles(article, none).every((related) =>
              visibleArticle(related, none),
            ),
      expected: true,
    });
  });
});
