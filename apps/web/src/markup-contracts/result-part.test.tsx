import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../lib/testing/mock-router';
import { renderMarkup } from '../test-support/rendered/markup';

await mockNextRouter();
const { ResultUnavailable } = await import('../ui/round-result/result-part');

setupRitewayBun();

/**
 * The retry link's empty `href` is the contract: it asks for this page again
 * in place. The accessibility tree does not expose an anchor whose `href` is
 * empty as a link, so only the markup can say it is there.
 */
test('an unavailable result part offers a link that reloads in place', () => {
  const retry = (retrySeconds: number | null) =>
    /<a [^>]*href=""[^>]*>Try now<\/a>/.test(
      renderMarkup(<ResultUnavailable retrySeconds={retrySeconds} />),
    );
  assert({
    given: 'a part refused for now, and one whose failure may last',
    should: 'offer Try now as a link to this same page in both',
    actual: [retry(3), retry(null)],
    expected: [true, true],
  });
});
