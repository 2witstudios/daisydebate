import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { done } from '../../../features/forms/form-state';
import { counterText, PublicProfileForm } from './public-profile-form';

setupRitewayBun();

const render = (displayName: string | null, bio: string | null) =>
  renderToStaticMarkup(
    <PublicProfileForm
      action={async () => done()}
      displayName={displayName}
      bio={bio}
    />,
  );

describe('PublicProfileForm', () => {
  test('a member’s saved text', () => {
    const html = render('Ada Byron', 'Negative, always.');
    assert({
      given: 'a saved display name and bio',
      should:
        'post both fields to the server action, filled in, each with its counter',
      actual: [
        html.match(/<form /g)?.length,
        html.includes('name="displayName"'),
        html.includes('value="Ada Byron"'),
        html.includes('>Negative, always.</textarea>'),
        html.includes('9 of 40 characters'),
        html.includes('17 of 160 characters'),
      ],
      expected: [1, true, true, true, true, true],
    });
  });

  test('nothing set', () => {
    const html = render(null, null);
    assert({
      given: 'no display name or bio',
      should: 'offer empty fields with nothing counted',
      actual: [
        html.includes('0 of 40 characters'),
        html.includes('0 of 160 characters'),
      ],
      expected: [true, true],
    });
  });

  test('a saved name over the limit', () => {
    const html = render('x'.repeat(41), null);
    assert({
      given: 'text longer than the limit',
      should: 'mark the field invalid and hold Save back',
      actual: [
        html.includes('aria-invalid="true"'),
        /<button[^>]*disabled=""[^>]*>Save</.test(html),
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
