import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { PrivacyPage } from './privacy-page';

setupRitewayBun();

const view = renderAccessible(h(PrivacyPage));
const text = view.textContent();

describe('PrivacyPage', () => {
  test('three sections', () => {
    assert({
      given: 'the privacy page',
      should: 'have one h1 and the three sections with their rules',
      actual: [
        view.count('heading', undefined, { level: 1 }),
        view.names('heading', { level: 2 }),
        text.includes('Ratings while you judge'),
        text.includes('Closed accounts'),
        text.includes('ADR'),
      ],
      expected: [
        1,
        ['Public', 'Private', 'Hidden on purpose'],
        true,
        true,
        false,
      ],
    });
  });

  test('publishes only real ladder privacy behavior', () => {
    assert({
      given: 'the live leaderboard privacy disclosure',
      should:
        'describe public ranked records without a fake opt-out, profile fields or sample rating',
      actual: [
        text.includes('Your privacy settings'),
        text.includes('Change in settings'),
        text.includes('Display name and image'),
        text.includes('1538'),
        text.includes('Never listed, and never rated'),
        text.includes('Room visibility does not turn off rating'),
      ],
      expected: [false, false, false, false, false, true],
    });
  });
});
