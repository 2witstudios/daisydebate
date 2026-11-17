import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  renderProfilePhotoControl,
  type ProfilePhotoControlProps,
} from './profile-photo-control.render';

setupRitewayBun();

const published = 'f'.repeat(24);
const inReview = 'g'.repeat(24);

const props = (
  overrides: Partial<ProfilePhotoControlProps> = {},
): ProfilePhotoControlProps => ({
  name: 'debater-a',
  photo: { published: null, inReview: null },
  photoUploads: 'available',
  activity: 'idle',
  notice: null,
  onChoose: () => {},
  onRemove: () => {},
  ...overrides,
});

const html = (overrides: Partial<ProfilePhotoControlProps> = {}) =>
  renderToStaticMarkup(renderProfilePhotoControl(props(overrides)));

describe('renderProfilePhotoControl', () => {
  test('no photo yet', () => {
    const page = html();
    assert({
      given: 'a member with no photo on a deployment that takes uploads',
      should:
        'offer an upload of JPEG, PNG or WebP outside any form, and nothing to remove',
      actual: [
        page.includes('Upload photo'),
        page.includes('type="file"'),
        page.includes('accept="image/jpeg,image/png,image/webp"'),
        page.includes('<form'),
        page.includes('Remove photo'),
      ],
      expected: [true, true, true, false, false],
    });
  });

  test('a published photo and a newer one in review', () => {
    const page = html({ photo: { published, inReview } });
    assert({
      given: 'a published photo and its replacement in review',
      should:
        'preview both at 128 px, mark the newer one In review and offer Remove photo',
      actual: [
        page.includes(`src="/api/profile-photos/${published}/128"`),
        page.includes(`src="/api/profile-photos/${inReview}/128"`),
        page.includes('In review'),
        page.includes('Remove photo'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('uploads unavailable', () => {
    const page = html({
      photoUploads: 'unavailable',
      photo: { published, inReview: null },
    });
    assert({
      given: 'a deployment with no scanner or bucket',
      should: 'hide the upload with a short note and still let the photo go',
      actual: [
        page.includes('type="file"'),
        page.includes('Photo uploads are unavailable right now.'),
        page.includes('Remove photo'),
      ],
      expected: [false, true, true],
    });
  });

  test('while a request is out, and after', () => {
    const page = html({
      photo: { published, inReview: null },
      activity: 'uploading',
      notice: 'Photo updated.',
    });
    assert({
      given: 'an upload on its way, then the notice it answered with',
      should:
        'disable both controls, say it is uploading and announce the notice',
      actual: [
        page.includes('Uploading…'),
        page.match(/disabled=""/g)?.length,
        /role="status"[^>]*>Photo updated.</.test(page),
      ],
      expected: [true, 2, true],
    });
  });

  test('choosing and removing', () => {
    const chosen: string[] = [];
    let removed = 0;
    const element = renderProfilePhotoControl(
      props({
        photo: { published, inReview: null },
        onChoose: (file) => chosen.push(file.name),
        onRemove: () => {
          removed += 1;
        },
      }),
    );
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    const input = { files: [file], value: 'C:\\fakepath\\me.png' };
    // The markup's own handlers, invoked off the returned element.
    const [, controls] = element.props.children;
    const [label, remove] = controls.props.children;
    label.props.children[1].props.onChange({ currentTarget: input });
    remove.props.onClick();
    assert({
      given: 'a file chosen, then Remove photo',
      should:
        'hand the file on, clear the input so the same file can be chosen again, and remove',
      actual: [chosen, input.value, removed],
      expected: [['me.png'], '', 1],
    });
  });
});
