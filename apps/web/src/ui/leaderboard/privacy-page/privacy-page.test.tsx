import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PrivacyPage } from './privacy-page';

setupRitewayBun();

const html = renderToString(h(PrivacyPage)).replace(/<!-- -->/g, '');

describe('PrivacyPage', () => {
  test('three sections', () => {
    assert({
      given: 'the privacy page',
      should: 'have one h1 and the three sections with their rules',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('>Public<'),
        html.includes('>Private<'),
        html.includes('>Hidden on purpose<'),
        html.includes('Ratings while you judge'),
        html.includes('Deleted accounts'),
        html.includes('ADR'),
      ],
      expected: [1, true, true, true, true, true, false],
    });
  });

  test('the settings show their current answers and link to Settings', () => {
    assert({
      given: 'the account privacy settings',
      should:
        'show region off and ladder on, with no switches, and link to change them',
      actual: [
        html.includes('Your privacy settings'),
        html.includes('role="switch"'),
        html.includes('>On<'),
        html.includes('>Off<'),
        html.includes('href="/settings#privacy"'),
      ],
      expected: [true, false, true, true, true],
    });
  });
});
