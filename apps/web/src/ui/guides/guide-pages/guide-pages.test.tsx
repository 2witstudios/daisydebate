import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  collectionOf,
  findArticle,
  homeShelf,
  readingHomes,
  relatedArticles,
} from '../../../features/guides/library';
import { helpTopics } from '../../../features/help/topics';
import { HelpPage } from '../../help/help-page/help-page';
import { ArticlePage, HomeShelfPage, StoriesPage } from './guide-pages';

setupRitewayBun();

const none = new Set<never>();

describe('ArticlePage', () => {
  const article = findArticle(
    'guides',
    'judging',
    'understanding-a-ballot',
    none,
  );
  const collection = article && collectionOf(article);
  const html =
    article && collection
      ? renderToString(
          h(ArticlePage, {
            article,
            collection,
            related: relatedArticles(article, none),
          }),
        )
      : '';

  test('an article with its way back and onward', () => {
    assert({
      given: 'the ballot guide',
      should:
        'render its title, a breadcrumb to its collection, its links and what to read next',
      actual: [
        html.includes('<h1'),
        html.includes('Understanding a Daisy ballot'),
        html.includes('href="/guides/judging"'),
        html.includes(
          'href="/learn/judging-and-feedback/writing-a-reason-for-decision"',
        ),
        html.includes('Read next'),
        html.includes('dateTime="2026-11-23"'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });
});

describe('HomeShelfPage', () => {
  test('each collection with its articles', () => {
    const html = renderToString(
      h(HomeShelfPage, { home: 'learn', shelves: homeShelf('learn', none) }),
    );
    assert({
      given: 'the Learn shelves',
      should: 'link the collection and each of its articles',
      actual: [
        html.includes('href="/learn/judging-and-feedback"'),
        html.includes('href="/learn/judging-and-feedback/making-a-decision"'),
      ],
      expected: [true, true],
    });
  });
});

describe('StoriesPage', () => {
  test('nothing yet', () => {
    assert({
      given: 'no stories',
      should: 'say so in one line',
      actual: renderToString(h(StoriesPage, { stories: [] })).includes(
        'Nothing published yet.',
      ),
      expected: true,
    });
  });
});

describe('Help, the front door', () => {
  test('lists the homes with something to read', () => {
    const html = renderToString(
      h(HelpPage, { homes: readingHomes(none), topics: helpTopics }),
    );
    assert({
      given: 'the pilot library and no stories',
      should: 'link Guides and Learn, not Stories, above the common questions',
      actual: [
        html.includes('href="/guides"'),
        html.includes('href="/learn"'),
        html.includes('href="/stories"'),
        html.indexOf('href="/guides"') < html.indexOf('Common questions'),
      ],
      expected: [true, true, false, true],
    });
  });
});
