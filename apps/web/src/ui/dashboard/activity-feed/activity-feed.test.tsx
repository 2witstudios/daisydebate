import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ActivityFeed } from './activity-feed';
import { createInitialState } from '../../store/state';
import { setUiState } from '../../store/store';

setupRitewayBun();

const seed = createInitialState();

const renderWith = (activities: typeof seed.collections.activities): string => {
  setUiState({ ...seed, collections: { ...seed.collections, activities } });
  return renderToString(h(ActivityFeed));
};

describe('ActivityFeed', () => {
  test('renders headline, meta, and the actor avatar for an activity', () => {
    const html = renderWith([
      {
        headline: 'Ada won a debate',
        meta: '1 minute ago',
        actor: 'Ada Byron',
      },
    ]);
    assert({
      given: 'one persona activity',
      should: 'render its headline, meta, and the avatar naming the actor',
      actual: [
        html.includes('Ada won a debate'),
        html.includes('1 minute ago'),
        html.includes('>Ada Byron</span>'),
      ],
      expected: [true, true, true],
    });
  });

  test('renders system announcements without an avatar', () => {
    const html = renderWith([
      { headline: 'Registration open', meta: 'now', actor: null },
    ]);
    assert({
      given: 'an activity with no actor',
      should: 'render the headline with a decorative icon and no avatar name',
      actual: [
        html.includes('Registration open'),
        html.includes('visually-hidden'),
        /<span[^>]* aria-hidden="true"><svg/.test(html),
      ],
      expected: [true, false, true],
    });
  });
});
