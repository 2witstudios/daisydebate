import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { WatchBusy } from './watch-busy';

setupRitewayBun();

test('it offers the same page again, with a real link', () => {
  const view = renderAccessible(<WatchBusy retryHref="/watch/abc" />);
  assert({
    given: 'a refused Watch page',
    should: 'say so and link back to it',
    actual: [
      view.has('heading', 'A lot of people are watching', { level: 1 }),
      view.attribute('link', 'Try again', 'href'),
    ],
    expected: [true, '/watch/abc'],
  });
});
