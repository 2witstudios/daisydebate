import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoundReconnecting } from './round-reconnecting';

setupRitewayBun();

test('the temporary state recovers by itself and claims nothing about the Round', () => {
  const html = renderToString(<RoundReconnecting retrySeconds={3} />);
  assert({
    given: 'a Round room whose read was temporarily refused',
    should:
      'refresh with no script, announce it, offer a link and show no control',
    actual: {
      refresh: html.includes('http-equiv="refresh" content="3"'),
      status: html.includes('role="status"'),
      link: html.includes('href=""'),
      controls: html.includes('<button') || html.includes('<form'),
    },
    expected: { refresh: true, status: true, link: true, controls: false },
  });
});

test('a page with shell links leaves the refresh to a page with no script', () => {
  const html = renderToString(<RoundReconnecting retrySeconds={3} shell />);
  assert({
    given: 'the Round page under the shell',
    should: 'keep the refresh inside noscript, where script never parses it',
    actual:
      /<noscript><meta http-equiv="refresh" content="3"\/?><\/noscript>/.test(
        html,
      ),
    expected: true,
  });
});
