import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Button } from '../../components/button/button';
import { byText } from '../../test-support/find-elements';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { CheckInbox, type CheckInboxProps } from './check-inbox';

setupRitewayBun();

const props = (overrides: Partial<CheckInboxProps> = {}): CheckInboxProps => ({
  email: 'jordan@lincoln.edu',
  resendInMs: 42_000,
  resending: false,
  resend: () => {},
  changeEmail: () => {},
  ...overrides,
});

const render = (overrides: Partial<CheckInboxProps> = {}) =>
  renderAccessible(h(CheckInbox, props(overrides)));

const disabledButtons = (view: ReturnType<typeof render>) =>
  view.all('button').filter((button) => button.hasAttribute('disabled'));

describe('CheckInbox', () => {
  test('never confirms that an account exists', () => {
    const view = render();
    assert({
      given: 'a sent link',
      should: 'hedge on delivery and name the limits',
      actual: [
        view.text('strong'),
        view.textContent().includes('If jordan@lincoln.edu can receive email'),
        view.textContent().includes('expires') &&
          view.textContent().includes('5 minutes'),
      ],
      expected: ['jordan@lincoln.edu', true, true],
    });
  });

  test('counts down to the resend', () => {
    const view = render();
    assert({
      given: '42 seconds left',
      should: 'show the countdown on a disabled resend button',
      actual: view.get('button', 'Resend in 0:42').hasAttribute('disabled'),
      expected: true,
    });
  });

  test('offers the resend once the cooldown ends', () => {
    const view = render({ resendInMs: 0 });
    assert({
      given: 'no time left',
      should: 'enable the resend',
      actual: [view.has('button', 'Resend link'), disabledButtons(view).length],
      expected: [true, 0],
    });
  });

  test('wires the actions', () => {
    const calls: string[] = [];
    const tree = CheckInbox(
      props({
        resendInMs: 0,
        resend: () => calls.push('resend'),
        changeEmail: () => calls.push('change'),
      }),
    );
    (byText(tree, Button, 'Resend link')?.props['onClick'] as () => void)();
    (
      byText(tree, Button, 'Use a different email')?.props[
        'onClick'
      ] as () => void
    )();
    assert({
      given: 'a resend and a change of address',
      should: 'call both actions',
      actual: calls,
      expected: ['resend', 'change'],
    });
  });
});
