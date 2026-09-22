import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { UsernameForm, type UsernameFormProps } from './username-form';

setupRitewayBun();

const render = (overrides: Partial<UsernameFormProps> = {}) =>
  renderToString(
    h(UsernameForm, {
      username: 'ada',
      pending: false,
      typeUsername: () => {},
      submit: () => {},
      signInHref: '/sign-in?next=%2Fonboarding%2Fusername',
      ...overrides,
    }),
  );

describe('UsernameForm', () => {
  test('labels the field and states the rule', () => {
    const page = render();
    assert({
      given: 'the choose step',
      should: 'label the input and describe it with the rule',
      actual: [
        page.includes('<label for="username"'),
        page.includes('aria-describedby="username-hint"'),
        page.includes('3 to 32 letters, numbers, underscores or hyphens.'),
      ],
      expected: [true, true, true],
    });
  });

  test('marks a refused name invalid and ties it to the notice', () => {
    const page = render({ notice: 'taken' });
    assert({
      given: 'a taken name',
      should: 'flag the input and describe it by the hint and the alert',
      actual: [
        page.includes('aria-invalid="true"'),
        page.includes('aria-describedby="username-hint username-notice"'),
        page.includes('role="alert"'),
      ],
      expected: [true, true, true],
    });
  });

  test('offers a way back when the session ended', () => {
    assert({
      given: 'the signed-out notice, and then another notice',
      should: 'link to sign-in only for the signed-out case',
      actual: [
        render({ notice: 'signed-out' }).includes(
          'href="/sign-in?next=%2Fonboarding%2Fusername"',
        ),
        render({ notice: 'taken' }).includes('Sign in again</a>'),
      ],
      expected: [true, false],
    });
  });
});
