import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import {
  renderProfilePhotoControl,
  type ProfilePhotoControlProps,
} from '../ui/settings/preferences/profile-photo-control.render';

setupRitewayBun();

const published = 'f'.repeat(24);

const html = (overrides: Partial<ProfilePhotoControlProps> = {}) =>
  renderMarkup(
    renderProfilePhotoControl({
      name: 'debater-a',
      photo: { published: null, inReview: null },
      photoUploads: 'available',
      activity: 'idle',
      notice: null,
      onChoose: () => {},
      onRemove: () => {},
      ...overrides,
    }),
  );

/**
 * A native file input has no ARIA role, so its presence, the types it
 * accepts and its disabled state are read from the markup; so is the
 * absence of a form, which keeps an upload off the pre-hydration post.
 */
describe('renderProfilePhotoControl markup', () => {
  test('the file input', () => {
    const page = html();
    const busy = html({
      photo: { published, inReview: null },
      activity: 'uploading',
    });
    assert({
      given: 'uploads available, unavailable, and an upload on its way',
      should:
        'offer a JPEG, PNG or WebP file input outside any form, none when unavailable, and disable it with Remove photo while busy',
      actual: [
        page.includes('type="file"'),
        page.includes('accept="image/jpeg,image/png,image/webp"'),
        page.includes('<form'),
        html({
          photoUploads: 'unavailable',
          photo: { published, inReview: null },
        }).includes('type="file"'),
        /<input type="file"[^>]*disabled=""/.test(busy),
        busy.match(/disabled=""/g)?.length,
      ],
      expected: [true, true, false, false, true, 2],
    });
  });
});
