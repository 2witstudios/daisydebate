import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { BetaWaiting } from './beta-waiting';

setupRitewayBun();

/** The page's server action; rendering never calls it. */
const noSignOut = async () => {};

describe('BetaWaiting (ADR 0075)', () => {
  test('a pending account is told it is on the list, with its account one link away', () => {
    const html = renderToString(
      h(BetaWaiting, {
        username: 'ada',
        reason: 'pending',
        ageHref: '/onboarding/age?next=%2Fbeta',
        signOutAction: noSignOut,
      }),
    );
    assert({
      given: 'a pending account',
      should:
        'name it on the list, link to its settings and offer a sign-out form, without script (ISSUE-691)',
      actual: {
        headline: html.includes('You&#x27;re on the list, @ada'),
        settings: html.includes('href="/settings"'),
        signOut: /<form[^>]*>.*Sign out<\/button><\/form>/.test(html),
        // React's own form-action replay helper aside, no client script.
        script: html
          .replace(/<script>addEventListener\("submit"[\s\S]*?<\/script>/, '')
          .includes('<script'),
      },
      expected: {
        headline: true,
        settings: true,
        signOut: true,
        script: false,
      },
    });
  });

  test('a revoked account is told its access is paused', () => {
    const html = renderToString(
      h(BetaWaiting, {
        username: 'ada',
        reason: 'revoked',
        ageHref: '/onboarding/age?next=%2Fbeta',
        signOutAction: noSignOut,
      }),
    );
    assert({
      given: 'a revoked account',
      should: 'say access is paused and never that it is on the list',
      actual: [
        html.includes('Your beta access is paused'),
        html.includes('on the list'),
      ],
      expected: [true, false],
    });
  });

  test('an account without an age record is sent to the age step', () => {
    const html = renderToString(
      h(BetaWaiting, {
        username: 'ada',
        reason: 'age-required',
        ageHref: '/onboarding/age?next=%2Fbeta',
        signOutAction: noSignOut,
      }),
    );
    assert({
      given: 'an approved or pending account with no durable 16+ age record',
      should:
        'ask for its age and link to the age step, never say it is on the list',
      actual: [
        html.includes('href="/onboarding/age?next=%2Fbeta"'),
        html.includes('16 and older'),
        html.includes('on the list'),
      ],
      expected: [true, true, false],
    });
  });
});
