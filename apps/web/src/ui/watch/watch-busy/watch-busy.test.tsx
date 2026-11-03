import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { WatchBusy } from './watch-busy';

setupRitewayBun();

test('it offers the same page again, with a real link', () => {
  const html = renderToStaticMarkup(<WatchBusy retryHref="/watch/abc" />);
  assert({
    given: 'a refused Watch page',
    should: 'say so and link back to it',
    actual: [
      html.includes('A lot of people are watching'),
      html.includes('href="/watch/abc"'),
    ],
    expected: [true, true],
  });
});
