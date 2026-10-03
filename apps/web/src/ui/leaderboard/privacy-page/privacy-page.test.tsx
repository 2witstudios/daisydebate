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
        html.includes('ADR 0036'),
      ],
      expected: [1, true, true, true, true, true, true],
    });
  });

  test('the settings are switches in their proposed state', () => {
    assert({
      given: 'the proposed privacy settings',
      should: 'render two working switches, region off and ladder on',
      actual: [
        html.match(/role="switch"/g)?.length,
        html.match(/disabled=""/g)?.length,
        html.match(/checked=""/g)?.length,
        html.includes('Proposal'),
        html.includes('<form'),
      ],
      expected: [2, undefined, 1, true, false],
    });
  });

  test('the region is marked proposed', () => {
    assert({
      given: 'the region row',
      should: 'carry the proposed marker',
      actual: html.includes('>proposed<'),
      expected: true,
    });
  });
});
