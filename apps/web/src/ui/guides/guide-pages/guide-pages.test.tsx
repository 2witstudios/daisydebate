import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  collectionOf,
  findArticle,
  homeShelf,
  readingHomes,
  relatedArticles,
} from '../../../features/guides/library';
import { helpTopics } from '../../../features/help/topics';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { HelpPage } from '../../help/help-page/help-page';
import { ArticlePage, HomeShelfPage, StoriesPage } from './guide-pages';

setupRitewayBun();

const none = new Set<never>();

const hrefs = (view: AccessibleView): readonly (string | null)[] =>
  view.all('link').map((link) => link.getAttribute('href'));

describe('ArticlePage', () => {
  const article = findArticle(
    'guides',
    'judging',
    'understanding-a-ballot',
    none,
  );
  const collection = article && collectionOf(article);

  test('an article with its way back and onward', () => {
    const view =
      article && collection
        ? renderAccessible(
            h(ArticlePage, {
              article,
              collection,
              related: relatedArticles(article, none),
            }),
          )
        : undefined;
    assert({
      given: 'the ballot guide',
      should:
        'render its title, a breadcrumb to its collection, its links, what to read next and the day it was checked',
      actual: view && [
        view.has('heading', 'Understanding a Daisy ballot', { level: 1 }),
        hrefs(view).includes('/guides/judging'),
        hrefs(view).includes(
          '/learn/judging-and-feedback/writing-a-reason-for-decision',
        ),
        view.has('heading', 'Read next'),
        view.textContent().includes('Updated 2026-11-23'),
      ],
      expected: [true, true, true, true, true],
    });
  });
});

describe('HomeShelfPage', () => {
  test('each collection with its articles', () => {
    const view = renderAccessible(
      h(HomeShelfPage, { home: 'learn', shelves: homeShelf('learn', none) }),
    );
    assert({
      given: 'the Learn shelves',
      should: 'link the collection and each of its articles',
      actual: [
        hrefs(view).includes('/learn/judging-and-feedback'),
        hrefs(view).includes('/learn/judging-and-feedback/making-a-decision'),
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
      actual: renderAccessible(h(StoriesPage, { stories: [] }))
        .textContent()
        .includes('Nothing published yet.'),
      expected: true,
    });
  });
});

describe('Help, the front door', () => {
  test('lists the homes with something to read', () => {
    const view = renderAccessible(
      h(HelpPage, { homes: readingHomes(none), topics: helpTopics }),
    );
    const reading = hrefs(view.within('list', 'Guides and learning'));
    const questions = view.get('heading', 'Common questions');
    assert({
      given: 'the pilot library and no stories',
      should: 'list Guides and Learn, not Stories, before the common questions',
      actual: [
        reading.includes('/guides'),
        reading.includes('/learn'),
        reading.includes('/stories'),
        Boolean(
          view
            .get('list', 'Guides and learning')
            .compareDocumentPosition(questions) &
          questions.DOCUMENT_POSITION_FOLLOWING,
        ),
      ],
      expected: [true, true, false, true],
    });
  });
});
