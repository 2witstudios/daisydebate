import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { profilePhotoSrc } from './photo-src';

setupRitewayBun();

describe('profilePhotoSrc', () => {
  test('a photo and none', () => {
    const photoId = 'f'.repeat(24);
    assert({
      given: 'a published photo at each size, then no photo',
      should:
        'serve it through the application, and name no source without one',
      actual: [
        profilePhotoSrc(photoId, 512),
        profilePhotoSrc(photoId, 128),
        profilePhotoSrc(null, 128),
      ],
      expected: [
        `/api/profile-photos/${photoId}/512`,
        `/api/profile-photos/${photoId}/128`,
        undefined,
      ],
    });
  });
});
