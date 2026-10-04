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

  test('the settings are inert proposals', () => {
    assert({
      given: 'the proposed privacy settings',
      should: 'render disabled switches in their proposed state',
      actual: [
        html.match(/role="switch"/g)?.length,
        html.match(/disabled=""/g)?.length,
        html.includes('<form'),
      ],
      expected: [2, 2, false],
    });
  });
});
