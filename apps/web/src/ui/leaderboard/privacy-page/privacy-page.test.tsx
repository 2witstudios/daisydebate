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
        html.includes('Closed accounts'),
        html.includes('ADR'),
      ],
      expected: [1, true, true, true, true, true, false],
    });
  });

  test('publishes only real ladder privacy behavior', () => {
    assert({
      given: 'the live leaderboard privacy disclosure',
      should:
        'describe public rated records without a fake opt-out, profile fields or sample rating',
      actual: [
        html.includes('Your privacy settings'),
        html.includes('Change in settings'),
        html.includes('Display name and image'),
        html.includes('1538'),
        html.includes('Never listed, and never rated'),
        html.includes('Room visibility does not turn off rating'),
      ],
      expected: [false, false, false, false, false, true],
    });
  });
});
