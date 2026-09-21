import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ConfirmSignIn } from './confirm-sign-in/confirm-sign-in';
import { LinkExpired } from './link-expired/link-expired';

setupRitewayBun();

const target = {
  action: '/auth/confirm',
  method: 'post',
  fields: { token: 'tok_123', callbackURL: '/lobby' },
} as const;

describe('ConfirmSignIn', () => {
  test('posts the link fields back without script', () => {
    const page = renderToString(h(ConfirmSignIn, { target }));
    assert({
      given: 'a confirm target',
      should: 'render a plain post form carrying every hidden field',
      actual: [
        page.includes('action="/auth/confirm"'),
        page.includes('method="post"'),
        page.includes('name="token" value="tok_123"'),
        page.includes('name="callbackURL" value="/lobby"'),
        page.includes('type="submit"'),
        page.includes('Sign in to Daisy'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('explains the extra tap and shows a refusal', () => {
    const page = renderToString(
      h(ConfirmSignIn, { target, notice: 'We could not complete sign-in.' }),
    );
    assert({
      given: 'a refusal notice',
      should: 'explain the tap in the panel and raise the notice as an alert',
      actual: [
        page.includes('Why one more tap?'),
        page.includes('role="alert"'),
        page.includes('We could not complete sign-in.'),
      ],
      expected: [true, true, true],
    });
  });
});

describe('LinkExpired', () => {
  test('asks for an email and posts a resend', () => {
    const page = renderToString(
      h(LinkExpired, {
        target: { ...target, fields: { intent: 'resend' } },
      }),
    );
    assert({
      given: 'a resend target',
      should: 'render a labelled, required email field in a post form',
      actual: [
        page.includes('This link can no longer be used.'),
        page.includes('name="intent" value="resend"'),
        page.includes('<label for="expired-email"'),
        page.includes('name="email"'),
        page.includes('required=""'),
        page.includes('Email me a new link'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });
});
