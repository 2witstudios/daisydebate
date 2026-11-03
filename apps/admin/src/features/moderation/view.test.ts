import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { moderationHref, moderationQuery } from './view';

setupRitewayBun();

describe('The moderation queue’s URL', () => {
  test('anything outside the closed sets is dropped', () => {
    assert({
      given: 'a junk queue, status, cursor and notice',
      should: 'fall back and echo none of it',
      actual: moderationQuery({
        queue: '<script>',
        status: 'nope',
        cursor: 'a b',
        notice: 'hacked',
      }),
      expected: {
        queue: 'safety',
        status: 'open',
        cursor: undefined,
        notice: null,
      },
    });
  });

  test('a link round-trips', () => {
    const href = moderationHref({
      queue: 'review',
      status: 'upheld',
      cursor: 'abc',
    });
    assert({
      given: 'the review queue’s upheld page',
      should: 'read back as itself',
      actual: moderationQuery(
        Object.fromEntries(new URL(href, 'http://a').searchParams),
      ),
      expected: {
        queue: 'review',
        status: 'upheld',
        cursor: 'abc',
        notice: null,
      },
    });
  });
});
