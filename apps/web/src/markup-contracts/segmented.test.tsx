import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { Segmented } from '../ui/components/segmented/segmented';

setupRitewayBun();

/**
 * Filling a phone is a responsive layout contract carried by classes alone;
 * no role, name or state says how wide the control lays out.
 */
describe('Segmented markup', () => {
  test('the phone fill adds its classes as separate tokens', () => {
    const html = renderMarkup(
      h(Segmented, {
        label: 'Lobby',
        fillOnPhone: true,
        segments: [{ label: 'Open lobby', href: '/lobby', selected: true }],
      }),
    );
    const tokens = (html.match(/class="([^"]*)"/g) ?? []).flatMap((c) =>
      c.slice(7, -1).split(' '),
    );
    assert({
      given: 'a segmented control that fills a phone',
      should: 'keep its padding and phone classes as whole tokens',
      actual: ['p-1', 'max-narrow:flex', 'max-narrow:flex-1'].every((t) =>
        tokens.includes(t),
      ),
      expected: true,
    });
  });
});
