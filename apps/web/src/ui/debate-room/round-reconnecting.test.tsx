import { renderAccessible } from '../../test-support/rendered/accessible';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../lib/testing/mock-router';

await mockNextRouter();
const { RoundReconnecting } = await import('./round-reconnecting');

setupRitewayBun();

test('the temporary state recovers by itself and claims nothing about the Round', () => {
  const view = renderAccessible(<RoundReconnecting retrySeconds={3} />);
  assert({
    given: 'a Round room whose read was temporarily refused',
    should: 'announce it, offer a link and show no control',
    actual: {
      status: view.has('status'),
      // The `href=""` that reloads in place: markup-contracts/round-reconnecting.
      link: view.textContent().includes('Try now'),
      controls:
        view.count('button') + view.count('textbox') + view.count('form'),
    },
    expected: { status: true, link: true, controls: 0 },
  });
});
