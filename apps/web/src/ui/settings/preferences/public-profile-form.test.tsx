import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { done } from '../../../features/forms/form-state';
import { counterText, PublicProfileForm } from './public-profile-form';

setupRitewayBun();

const render = (displayName: string | null, bio: string | null) =>
  renderAccessible(
    <PublicProfileForm
      action={async () => done()}
      displayName={displayName}
      bio={bio}
    />,
  );

describe('PublicProfileForm', () => {
  test('a member’s saved text', () => {
    const view = render('Ada Byron', 'Negative, always.');
    const form = view.get('button', 'Save').closest('form');
    assert({
      given: 'a saved display name and bio',
      should:
        'post both fields to the server action, filled in, each with its counter',
      actual: [
        form !== null &&
          [
            view.get('textbox', 'Display name'),
            view.get('textbox', 'Bio'),
          ].every((field) => field.closest('form') === form),
        view.attribute('textbox', 'Display name', 'name'),
        view.attribute('textbox', 'Display name', 'value'),
        view.text('textbox', 'Bio'),
        view.has('textbox', 'Display name', {
          description: '9 of 40 characters',
        }),
        view.has('textbox', 'Bio', { description: '17 of 160 characters' }),
      ],
      expected: [
        true,
        'displayName',
        'Ada Byron',
        'Negative, always.',
        true,
        true,
      ],
    });
  });

  test('nothing set', () => {
    const view = render(null, null);
    assert({
      given: 'no display name or bio',
      should: 'offer empty fields with nothing counted',
      actual: [
        view.has('textbox', 'Display name', {
          description: '0 of 40 characters',
        }),
        view.has('textbox', 'Bio', { description: '0 of 160 characters' }),
      ],
      expected: [true, true],
    });
  });

  test('a saved name over the limit', () => {
    const view = render('x'.repeat(41), null);
    assert({
      given: 'text longer than the limit',
      should: 'mark the field invalid and hold Save back',
      actual: [
        view.attribute('textbox', 'Display name', 'aria-invalid') === 'true',
        view.get('button', 'Save').hasAttribute('disabled'),
      ],
      expected: [true, true],
    });
  });
});

describe('counterText', () => {
  test('counts what a person sees', () => {
    assert({
      given: 'a name with an emoji',
      should: 'count the emoji once',
      actual: counterText('Ada 🌼', 40),
      expected: '5 of 40 characters',
    });
  });
});
