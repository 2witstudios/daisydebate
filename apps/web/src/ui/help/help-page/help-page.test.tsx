import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { helpTopics } from '../../../features/help/topics';
import { HelpPage } from './help-page';

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
});
