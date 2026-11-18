import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { helpTopics } from '../../../features/help/topics';
import { HelpPage } from './help-page';
import { topicFromHash } from './topic-from-hash';

setupRitewayBun();

describe('HelpPage', () => {
  test('every topic is a disclosure with its links', () => {
    const html = renderToString(h(HelpPage, { topics: helpTopics }));
    assert({
      given: 'the help topics',
      should: 'render one disclosure each and link to the privacy policy',
      actual: [
        html.split('<details').length - 1,
        html.includes('href="/privacy"'),
      ],
      expected: [helpTopics.length, true],
    });
  });

  test('each topic is addressable', () => {
    const html = renderToString(h(HelpPage, { topics: helpTopics }));
    assert({
      given: 'each topic id',
      should: 'name its question, inside the disclosure it opens',
      actual: helpTopics.filter(
        (topic) => !new RegExp(`<summary id="${topic.id}"`).test(html),
      ),
      expected: [],
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
