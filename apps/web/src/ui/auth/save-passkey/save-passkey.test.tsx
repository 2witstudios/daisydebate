import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Button } from '../../components/button/button';
import { byText } from '../../test-support/find-elements';
import { SavePasskey, type SavePasskeyProps } from './save-passkey';

setupRitewayBun();

const props = (
  overrides: Partial<SavePasskeyProps> = {},
): SavePasskeyProps => ({
  username: 'jordan_l',
  pending: false,
  savePasskey: () => {},
  markShared: () => {},
  dismiss: () => {},
  ...overrides,
});

describe('SavePasskey', () => {
  test('offers save, shared, and not now', () => {
    const page = renderToString(h(SavePasskey, props()));
    assert({
      given: 'a freshly claimed username',
      should: 'confirm who is signed in and offer all three choices',
      actual: [
        page.includes('Signed in as <!-- -->jordan_l'),
        page.includes('Save a passkey on this device'),
        page.includes('This is a shared computer'),
        page.includes('Not now'),
        page.includes('disabled=""'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('locks the choices while the device prompt is open', () => {
    const page = renderToString(h(SavePasskey, props({ pending: true })));
    assert({
      given: 'a pending save',
      should: 'say so and disable all three buttons',
      actual: [
        page.includes('Waiting for your device…'),
        page.match(/disabled=""/g)?.length,
      ],
      expected: [true, 3],
    });
  });

  test('wires the actions', () => {
    const calls: string[] = [];
    const tree = SavePasskey(
      props({
        savePasskey: () => calls.push('save'),
        markShared: () => calls.push('shared'),
        dismiss: () => calls.push('dismiss'),
      }),
    );
    for (const label of ['Save a passkey', 'shared computer', 'Not now'])
      (byText(tree, Button, label)?.props['onClick'] as () => void)();
    assert({
      given: 'each choice in turn',
      should: 'call its action',
      actual: calls,
      expected: ['save', 'shared', 'dismiss'],
    });
  });
});
