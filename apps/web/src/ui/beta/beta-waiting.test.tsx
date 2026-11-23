import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { BetaWaiting, type BetaWaitingProps } from './beta-waiting';

setupRitewayBun();

const render = (overrides: Partial<BetaWaitingProps> = {}) =>
  renderAccessible(
    h(BetaWaiting, {
      username: 'ada',
      reason: 'pending',
      ageHref: '/onboarding/age?next=%2Fbeta',
      ...overrides,
    }),
  );

describe('BetaWaiting (ADR 0075)', () => {
  test('a pending account is told it is on the list, with its account one link away', () => {
    const view = render({ reason: 'pending' });
    assert({
      given: 'a pending account',
      should: 'name it on the list and link to its settings, before hydration',
      actual: {
        headline: view.has('heading', "You're on the list, @ada", {
          level: 1,
        }),
        settings: view.attribute('link', 'Account settings', 'href'),
      },
      expected: { headline: true, settings: '/settings' },
    });
  });

  test('a revoked account is told its access is paused', () => {
    const view = render({ reason: 'revoked' });
    assert({
      given: 'a revoked account',
      should: 'say access is paused and never that it is on the list',
      actual: [
        view.has('heading', 'Your beta access is paused', { level: 1 }),
        view.textContent().includes('on the list'),
      ],
      expected: [true, false],
    });
  });

  test('an account without an age record is sent to the age step', () => {
    const view = render({ reason: 'age-required' });
    const text = view.textContent();
    assert({
      given: 'an approved or pending account with no durable 13+ age record',
      should:
        'ask for its age and link to the age step, never say it is on the list',
      actual: [
        view.attribute('link', 'Add your age', 'href'),
        text.includes('13 and older') && !text.includes('16 and older'),
        text.includes('on the list'),
      ],
      expected: ['/onboarding/age?next=%2Fbeta', true, false],
    });
  });
});

describe('signing out of /beta before hydration (ISSUE-691)', () => {
  test('every waiting reason carries a native sign-out form', () => {
    const forms = (['pending', 'revoked', 'age-required'] as const).map(
      (reason) => {
        const button = render({ reason }).get('button', 'Sign out');
        const form = button.closest('form');
        return {
          action: form?.getAttribute('action'),
          method: form?.getAttribute('method'),
          next: [...(form?.querySelectorAll('input') ?? [])].map((input) => [
            input.getAttribute('type'),
            input.getAttribute('name'),
            input.getAttribute('value'),
          ]),
          type: button.getAttribute('type'),
        };
      },
    );
    assert({
      given: 'a pending, a revoked and an age-required account',
      should: 'offer a sign-out form that posts before hydration on each page',
      actual: forms,
      expected: Array.from({ length: 3 }, () => ({
        action: '/auth/sign-out',
        method: 'post',
        next: [['hidden', 'next', '/beta']],
        type: 'submit',
      })),
    });
  });

  test('a failed sign-out is said plainly', () => {
    const notice = 'We couldn’t sign you out. Please try again.';
    const failed = render({ signOutFailed: true });
    const failedAlert = failed.has('alert') ? failed.text('alert') : null;
    const ordinary = render({ signOutFailed: false });
    assert({
      given: 'a return from a failed sign-out, and an ordinary visit',
      should: 'announce the failure only on the return',
      actual: [failedAlert, ordinary.textContent().includes(notice)],
      expected: [notice, false],
    });
  });
});

describe('the waiting status', () => {
  test('a pending account sees where it stands and what to do meanwhile', () => {
    const view = render({ reason: 'pending' });
    const text = view.textContent();
    assert({
      given: 'a pending account',
      should:
        'show the three-step status and two things to do while waiting, with its way out last',
      actual: [
        text.includes('Account ready'),
        text.includes('Waiting for approval'),
        text.includes('You are in'),
        view.has('heading', 'While you wait', { level: 2 }),
        view.has('link', 'Watch a debate See how a round plays out.'),
        view.has(
          'link',
          'See the leaderboard Look at the ladders you will climb.',
        ),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('a paused account sees no waiting status', () => {
    const view = render({ reason: 'revoked' });
    assert({
      given: 'a revoked account',
      should: 'not promise an approval or an email that is coming',
      actual: [
        view.textContent().includes('Waiting for approval'),
        view.textContent().includes('While you wait'),
        view.attribute('link', 'Account settings', 'href'),
      ],
      expected: [false, false, '/settings'],
    });
  });
});
