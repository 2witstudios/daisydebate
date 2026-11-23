import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Button } from '../../components/button/button';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { byText } from '../../test-support/find-elements';
import { SavePasskey, type SavePasskeyProps } from './save-passkey';

setupRitewayBun();

const props = (
  overrides: Partial<SavePasskeyProps> = {},
): SavePasskeyProps => ({
  username: 'jordan_l',
  pending: false,
  savePasskey: () => {},
  decline: () => {},
  ...overrides,
});

const disabledButtons = (view: ReturnType<typeof renderAccessible>) =>
  view.all('button').filter((button) => button.hasAttribute('disabled'));

describe('SavePasskey', () => {
  test('offers save, shared, and not now', () => {
    const view = renderAccessible(h(SavePasskey, props()));
    assert({
      given: 'a freshly claimed username',
      should: 'confirm who is signed in and offer all three choices',
      actual: [
        view.textContent().includes('Signed in as jordan_l'),
        view.has('button', 'Save a passkey on this device'),
        view.has('button', 'This is a shared computer'),
        view.has('button', 'Not now'),
        disabledButtons(view).length,
      ],
      expected: [true, true, true, true, 0],
    });
  });

  test('declining without a passkey is a real button in its own form, so it works before hydration', () => {
    const view = renderAccessible(h(SavePasskey, props()));
    const decline = ['This is a shared computer', 'Not now'].map((name) =>
      view.get('button', name),
    );
    assert({
      given: 'the shared-computer and not-now choices',
      should: 'be submit buttons inside their own forms, never links',
      actual: [
        new Set(
          view
            .all('button')
            .map((button) => button.closest('form'))
            .filter((form) => form !== null),
        ).size,
        decline.map((button) => button.getAttribute('type')),
        decline[0]?.closest('form') !== decline[1]?.closest('form'),
        view
          .all('button')
          .filter((button) => button.getAttribute('type') === 'submit').length,
        view.has('link', 'This is a shared computer'),
        view.has('link', 'Not now'),
      ],
      expected: [2, ['submit', 'submit'], true, 2, false, false],
    });
  });

  test('locks the choices while the device prompt is open', () => {
    const view = renderAccessible(h(SavePasskey, props({ pending: true })));
    assert({
      given: 'a pending save',
      should: 'say so and disable the save button and both decline buttons',
      actual: [
        view.get('button', 'Waiting for your device…').hasAttribute('disabled'),
        disabledButtons(view).map((button) => button.textContent),
      ],
      expected: [
        true,
        ['Waiting for your device…', 'This is a shared computer', 'Not now'],
      ],
    });
  });

  test('wires the save', () => {
    const calls: string[] = [];
    const tree = SavePasskey(props({ savePasskey: () => calls.push('save') }));
    (byText(tree, Button, 'Save a passkey')?.props['onClick'] as () => void)();
    assert({
      given: 'the save choice',
      should: 'call its action',
      actual: calls,
      expected: ['save'],
    });
  });
});
