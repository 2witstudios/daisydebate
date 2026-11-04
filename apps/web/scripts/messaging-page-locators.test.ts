import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isMessagingRefetch } from '../e2e/support/messaging-page-locators';

setupRitewayBun();

test('route reads remain visible except explicit Next prefetch', () => {
  assert({
    given: 'a refresh, navigation, explicit prefetch, and unrelated requests',
    should: 'exclude only explicit prefetch from RSC route reads',
    actual: [
      isMessagingRefetch({ rsc: '1' }),
      isMessagingRefetch({ rsc: '1', 'next-router-state-tree': 'tree' }),
      isMessagingRefetch({ rsc: '1', 'next-router-prefetch': '1' }),
      isMessagingRefetch({ rsc: '1', 'next-router-prefetch': '0' }),
      isMessagingRefetch({ rsc: '1', purpose: 'prefetch' }),
      isMessagingRefetch({}),
    ],
    expected: [true, true, false, true, true, false],
  });
});
