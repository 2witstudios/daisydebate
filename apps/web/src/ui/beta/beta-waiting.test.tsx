import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { BetaWaiting } from './beta-waiting';

setupRitewayBun();

describe('BetaWaiting (ADR 0075)', () => {
  test('a pending account is told it is on the list, with its account one link away', () => {
    const html = renderToString(
      h(BetaWaiting, {
        username: 'ada',
        reason: 'pending',
        ageHref: '/onboarding/age?next=%2Fbeta',
      }),
    );
    assert({
      given: 'a pending account',
      should: 'name it on the list and link to its settings, without script',
      actual: {
        headline: html.includes('You&#x27;re on the list, @ada'),
        settings: html.includes('href="/settings"'),
        script: html.includes('<script'),
      },
      expected: { headline: true, settings: true, script: false },
    });
  });

  test('a revoked account is told its access is paused', () => {
    const html = renderToString(
      h(BetaWaiting, {
        username: 'ada',
        reason: 'revoked',
        ageHref: '/onboarding/age?next=%2Fbeta',
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
