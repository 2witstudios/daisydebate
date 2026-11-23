import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { helpTopics } from '../../../features/help/topics';
import { HelpPage } from './help-page';
import { topicFromHash } from './topic-from-hash';

setupRitewayBun();

describe('HelpPage', () => {
  test('every topic is a disclosure with its links', () => {
    const view = renderAccessible(
      h(HelpPage, { homes: [], topics: helpTopics }),
    );
    assert({
      given: 'the help topics',
      should: 'render one disclosure each and link to the privacy policy',
      actual: [
        view.count('group'),
        // The link sits inside a closed disclosure, so out of the tree until opened.
        view
          .all('link', 'Privacy policy', { hidden: true })
          .some((link) => link.getAttribute('href') === '/privacy'),
      ],
      expected: [helpTopics.length, true],
    });
  });

  test('a question Help does not answer goes to support', () => {
    const html = renderToString(h(HelpPage, { topics: helpTopics }));
    assert({
      given: 'the help topics',
      should: 'link to /support after them',
      actual: html.includes('<a href="/support">Contact support</a>'),
      expected: true,
    });
  });

  test('each topic is addressable', () => {
    const view = renderAccessible(
      h(HelpPage, { homes: [], topics: helpTopics }),
    );
    assert({
      given: 'each topic id',
      should: 'name its question, inside the disclosure it opens',
      actual: view.all('group').map((disclosure) => {
        const summary = disclosure.querySelector(':scope > summary');
        return [summary?.id, summary?.textContent];
      }),
      expected: helpTopics.map((topic) => [topic.id, topic.question]),
    });
  });
});

describe('topicFromHash', () => {
  test('names a topic only for a fragment that is one', () => {
    const ids = ['ratings', 'ranked-recorded'];
    assert({
      given:
        'a topic fragment, an encoded one, an unknown one, a malformed one and none',
      should: 'return the topic for the first two and nothing otherwise',
      actual: [
        topicFromHash('#ratings', ids),
        topicFromHash('#ranked%2Drecorded', ids),
        topicFromHash('#nope', ids),
        topicFromHash('#%', ids),
        topicFromHash('#ranked%2', ids),
        topicFromHash('', ids),
      ],
      expected: ['ratings', 'ranked-recorded', null, null, null, null],
    });
  });
});
