import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../lib/testing/mock-router';

await mockNextRouter();
const { RoundReconnecting } = await import('./round-reconnecting');

setupRitewayBun();

test('the temporary state recovers by itself and claims nothing about the Round', () => {
  const html = renderToString(<RoundReconnecting retrySeconds={3} />);
  assert({
    given: 'a Round room whose read was temporarily refused',
    should:
      'refresh with no script, announce it, offer a link and show no control',
    actual: {
      refresh:
        /<noscript><meta http-equiv="refresh" content="3"\/?><\/noscript>/.test(
          html,
        ),
      status: html.includes('role="status"'),
      link: html.includes('href=""'),
      controls: html.includes('<button') || html.includes('<form'),
    },
    expected: { refresh: true, status: true, link: true, controls: false },
  });
});
