import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
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

const render = (overrides: Partial<ProfilePhotoControlProps> = {}) =>
  renderAccessible(renderProfilePhotoControl(props(overrides)));

describe('renderProfilePhotoControl', () => {
  test('no photo yet', () => {
    const view = render();
    assert({
      given: 'a member with no photo on a deployment that takes uploads',
      should:
        'offer an upload (its file input and types: see markup-contracts), and nothing to remove',
      actual: [
        view.textContent().includes('Upload photo'),
        view.has('button', 'Remove photo'),
      ],
      expected: [true, false],
    });
  });

  test('a published photo and a newer one in review', () => {
    const view = render({ photo: { published, inReview } });
    assert({
      given: 'a published photo and its replacement in review',
      should:
        'preview both at 128 px, mark the newer one In review and offer Remove photo',
      actual: [
        view.all('presentation').map((image) => image.getAttribute('src')),
        view.textContent().includes('In review'),
        view.has('button', 'Remove photo'),
      ],
      expected: [
        [
          `/api/profile-photos/${published}/128`,
          `/api/profile-photos/${inReview}/128`,
        ],
        true,
        true,
      ],
    });
  });

  test('uploads unavailable', () => {
    const view = render({
      photoUploads: 'unavailable',
      photo: { published, inReview: null },
    });
    assert({
      given: 'a deployment with no scanner or bucket',
      should:
        'hide the upload (no file input: see markup-contracts) with a short note and still let the photo go',
      actual: [
        view.textContent().includes('Upload photo'),
        view.textContent().includes('Photo uploads are unavailable right now.'),
        view.has('button', 'Remove photo'),
      ],
      expected: [false, true, true],
    });
  });

  test('while a request is out, and after', () => {
    const view = render({
      photo: { published, inReview: null },
      activity: 'uploading',
      notice: 'Photo updated.',
    });
    assert({
      given: 'an upload on its way, then the notice it answered with',
      should:
        'disable both controls (the file input: see markup-contracts), say it is uploading and announce the notice',
      actual: [
        view.textContent().includes('Uploading…'),
        view.get('button', 'Remove photo').hasAttribute('disabled'),
        view.text('status'),
      ],
      expected: [true, true, 'Photo updated.'],
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
