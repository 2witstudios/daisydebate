import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { EmailChangeForm } from './email-change-form';

setupRitewayBun();

describe('EmailChangeForm', () => {
  test('renders a form the browser can post before hydration', () => {
    const view = renderAccessible(
      h(EmailChangeForm, { action: async (state) => state }),
    );
    const field = view.get('textbox', 'New email address');
    assert({
      given: 'the server render, before anything is typed',
      should:
        'post the address as a required newEmail field with an enabled submit, never by GET',
      actual: [
        field.getAttribute('name') === 'newEmail',
        field.hasAttribute('required'),
        view.get('button', 'Change email').hasAttribute('disabled'),
        /get/i.test(field.closest('form')?.getAttribute('method') ?? ''),
      ],
      expected: [true, true, false, false],
    });
  });
});
