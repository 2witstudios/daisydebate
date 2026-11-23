import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Button } from '../../components/button/button';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { byText, findElements } from '../../test-support/find-elements';
import { SignInForm, type SignInFormProps } from './sign-in-form';

setupRitewayBun();

const props = (overrides: Partial<SignInFormProps> = {}): SignInFormProps => ({
  email: '',
  pending: 'none',
  typeEmail: () => {},
  action: () => {},
  requestLink: () => true,
  signInWithPasskey: () => {},
  ...overrides,
});

/** Submits the form's element, recording a prevented default in `calls`. */
const submit = (tree: ReturnType<typeof SignInForm>, calls: string[]) => {
  const form = findElements(tree, (element) => element.type === 'form')[0];
  (form?.props['onSubmit'] as (event: object) => void)({
    preventDefault: () => calls.push('prevented'),
  });
  return form;
};

const render = (overrides: Partial<SignInFormProps> = {}) =>
  renderAccessible(h(SignInForm, props(overrides)));

/** The form the email field posts in. */
const formOf = (view: ReturnType<typeof render>) =>
  view.get('textbox', 'Email').closest('form');

describe('SignInForm', () => {
  test('offers one email field and a passkey button', () => {
    const view = render();
    assert({
      given: 'an idle form',
      should:
        'label the email field, let the browser offer a passkey, and show both actions',
      actual: [
        view.has('textbox', 'Email'),
        view.attribute('textbox', 'Email', 'autocomplete'),
        view.attribute('textbox', 'Email', 'type'),
        view.has('button', 'Continue'),
        view.has('button', 'Sign in with a passkey'),
        view.count('heading', undefined, { level: 1 }),
      ],
      expected: [true, 'username webauthn', 'email', true, true, 1],
    });
  });

  test('sends new people to email, not the saved-passkey prompt', () => {
    const view = render();
    const hintId = view.attribute(
      'button',
      'Sign in with a passkey',
      'aria-describedby',
    );
    const hint = view
      .get('button', 'Sign in with a passkey')
      .ownerDocument.getElementById(hintId ?? '');
    assert({
      given: 'an idle form',
      should:
        'make email the path for everyone and tie a saved-passkeys-only hint to the passkey button',
      actual: [
        view
          .textContent()
          .includes("Enter your email and we'll send you a link."),
        hintId,
        hint?.textContent,
      ],
      expected: [
        true,
        'sign-in-passkey-hint',
        'For returning users. New here? Use your email.',
      ],
    });
  });

  test('disables both paths while a link is sending', () => {
    const view = render({ email: 'j@school.edu', pending: 'link' });
    assert({
      given: 'a pending link request',
      should: 'show progress, announce it, and disable every control',
      actual: [
        view.has('button', 'Sending…'),
        view.text('status'),
        formOf(view)?.getAttribute('aria-busy'),
        [...view.all('textbox'), ...view.all('button')].map((control) =>
          control.hasAttribute('disabled'),
        ),
      ],
      expected: [
        true,
        'Sending your sign-in link…',
        'true',
        [true, true, true],
      ],
    });
  });

  test('announces a waiting passkey ceremony', () => {
    const view = render({ pending: 'passkey' });
    assert({
      given: 'a pending passkey ceremony',
      should: 'tell the person to follow the browser prompt',
      actual: [
        view.has('button', 'Waiting for your passkey…'),
        view.text('status'),
      ],
      expected: [true, "Follow your browser's prompt to use your passkey."],
    });
  });

  test('ties an undeliverable address to the field as an alert', () => {
    const view = render({ email: 'j@school.edu', notice: 'undeliverable' });
    assert({
      given: 'an undeliverable notice',
      should: 'raise an alert the input points at',
      actual: [
        view.get('alert').id,
        view.attribute('textbox', 'Email', 'aria-invalid'),
        view.attribute('textbox', 'Email', 'aria-describedby'),
        view
          .text('alert')
          .includes('We cannot send sign-in emails to this address.'),
      ],
      expected: ['sign-in-notice', 'true', 'sign-in-notice', true],
    });
  });

  test('reports a cancelled passkey quietly, without blaming the address', () => {
    const view = render({ notice: 'passkey-cancelled' });
    const statuses = view.all('status').map((status) => status.textContent);
    assert({
      given: 'a cancelled passkey ceremony, which may mean no passkey is saved',
      should:
        'point a new person to email in a status, not an alert, and leave the input valid',
      actual: [
        statuses.some(
          (status) =>
            status?.includes('No passkey used.') &&
            status.includes('New here? Continue with your email.'),
        ),
        view.has('alert'),
        view.attribute('textbox', 'Email', 'aria-invalid'),
      ],
      expected: [true, false, null],
    });
  });

  test('wires the actions', () => {
    const calls: string[] = [];
    const action = () => {};
    const tree = SignInForm(
      props({
        typeEmail: (email) => calls.push(`type:${email}`),
        action,
        requestLink: () => {
          calls.push('link');
          return true;
        },
        signInWithPasskey: () => calls.push('passkey'),
      }),
    );
    const form = submit(tree, calls);
    (
      byText(tree, Button, 'Sign in with a passkey')?.props[
        'onClick'
      ] as () => void
    )();
    const field = findElements(
      tree,
      (element) => element.props['typeEmail'] !== undefined,
    )[0];
    (field?.props['typeEmail'] as (email: string) => void)('j@school.edu');
    assert({
      given: 'a submit, a passkey click, and typing',
      should:
        'post the form to its action, marking the request, and call the matching actions',
      actual: [form?.props['action'] === action, calls],
      expected: [true, ['link', 'passkey', 'type:j@school.edu']],
    });
  });

  test('keeps a request that must not post from posting', () => {
    const calls: string[] = [];
    submit(SignInForm(props({ requestLink: () => false })), calls);
    assert({
      given: 'a submit the flow refuses (an empty address, or one in flight)',
      should: 'stop the post',
      actual: calls,
      expected: ['prevented'],
    });
  });

  test('renders a form the browser can post before hydration', () => {
    const view = render();
    assert({
      given: 'the server render',
      should: 'post the address as the email field, and never by GET',
      actual: [
        view.attribute('textbox', 'Email', 'name'),
        formOf(view)?.getAttribute('method')?.toLowerCase() === 'get',
      ],
      expected: ['email', false],
    });
  });
});
