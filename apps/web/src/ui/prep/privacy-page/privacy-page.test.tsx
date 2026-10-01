import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PrivacyPage } from './privacy-page';

setupRitewayBun();

describe('PrivacyPage', () => {
  test('promises and the who-sees-what table', () => {
    const html = renderToString(h(PrivacyPage));
    assert({
      given: 'the privacy page',
      should:
        'have one h1, three promises, a captioned table of seven rows and no internal classification',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Private by default'),
        html.includes('Never part of a debate'),
        html.includes('<caption'),
        html.includes('What each person sees in a debate'),
        html.includes('No sign that a panel exists'),
        html.match(/<tr /g)?.length,
        /ADR|Proposed classification|owner decision/i.test(html),
      ],
      expected: [1, true, true, true, true, true, 7, false],
    });
  });
});
