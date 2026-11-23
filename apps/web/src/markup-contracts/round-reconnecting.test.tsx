import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../lib/testing/mock-router';
import { renderMarkup } from '../test-support/rendered/markup';

await mockNextRouter();
const { RoundReconnecting } =
  await import('../ui/debate-room/round-reconnecting');

setupRitewayBun();

/**
 * The retry link's empty `href` is the contract: it reloads this page in
 * place. The accessibility tree does not expose an anchor whose `href` is
 * empty as a link, so only the markup can say it is there.
 */
test('the reconnecting page offers a link that reloads it in place', () => {
  assert({
    given: 'a Round room whose read was temporarily refused',
    should: 'offer Try now as a link to this same page',
    actual: /<a [^>]*href=""[^>]*>Try now<\/a>/.test(
      renderMarkup(<RoundReconnecting retrySeconds={3} />),
    ),
    expected: true,
  });
});
