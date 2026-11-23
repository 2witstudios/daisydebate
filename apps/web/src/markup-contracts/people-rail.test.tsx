import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { person, rail } from '../ui/people/people-rail.test-support';

setupRitewayBun();

/**
 * The gap between a tab's word and its count is a spacing-scale contract
 * with no ARIA equivalent; the words and counts themselves are read by role
 * in ui/people/people-ui.test.tsx.
 */
test('the tabs keep their word and number apart on the spacing scale', () => {
  const html = renderMarkup(
    rail([
      person(),
      person({ username: 'bea', relation: 'friends', status: 'round' }),
      person({ username: 'cy', status: 'offline' }),
    ]),
  );
  const tabs = html.match(/<button[^>]*\saria-pressed="[^"]*"[^>]*>/g) ?? [];
  assert({
    given: 'the All and Friends tabs',
    should: 'space each word from its count on the spacing scale',
    actual: [
      tabs.length,
      tabs.every((button) => /\bgap-2\b/.test(button)),
      /gap-\d+\.5/.test(html),
    ],
    expected: [2, true, false],
  });
});
