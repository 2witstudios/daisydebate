import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  contentModerationHref,
  contentModerationQuery,
  profilePhotoSrc,
} from './view';

setupRitewayBun();

describe('The moderation queue’s URL', () => {
  test('anything outside the closed sets is dropped', () => {
    assert({
      given: 'a junk queue, status, cursor and notice',
      should: 'fall back and echo none of it',
      actual: contentModerationQuery({
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
    const href = contentModerationHref({
      queue: 'review',
      status: 'upheld',
      cursor: 'abc',
    });
    assert({
      given: 'the review queue’s upheld page',
      should: 'read back as itself',
      actual: contentModerationQuery(
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

describe('A profile photo shown to an operator', () => {
  const photo = (imageWebpBase64: string) => ({
    photoId: 'p'.repeat(24),
    status: 'in_review' as const,
    version: 1,
    imageWebpBase64,
  });

  test('well-formed base64 becomes a WebP data URL', () => {
    assert({
      given: 'a base64 rendition',
      should: 'be shown as a WebP image source',
      actual: profilePhotoSrc(photo('UklGRg==')),
      expected: 'data:image/webp;base64,UklGRg==',
    });
  });

  test('anything else shows no image', () => {
    assert({
      given: 'an empty rendition, and one carrying markup',
      should: 'give no image source for either',
      actual: [
        profilePhotoSrc(photo('')),
        profilePhotoSrc(photo('"><script>alert(1)</script>')),
      ],
      expected: [null, null],
    });
  });
});
