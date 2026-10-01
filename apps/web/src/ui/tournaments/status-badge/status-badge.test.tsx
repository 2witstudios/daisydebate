import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { StatusBadge, statusTone } from './status-badge';

setupRitewayBun();

describe('StatusBadge', () => {
  test('each status has a tone', () => {
    assert({
      given: 'every status',
      should: 'map open to accent, full to gold, live to live, rest neutral',
      actual: (
        ['open', 'not-open', 'full', 'closed', 'live', 'done'] as const
      ).map(statusTone),
      expected: ['accent', 'neutral', 'gold', 'neutral', 'live', 'neutral'],
    });
  });

  test('the label is the status wording', () => {
    assert({
      given: 'a full and a live badge',
      should: 'say the wording; live carries a dot',
      actual: [
        renderToString(h(StatusBadge, { status: 'full' })).includes(
          'Full, waitlist',
        ),
        renderToString(h(StatusBadge, { status: 'live' })).includes('bg-live'),
      ],
      expected: [true, true],
    });
  });
});
