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
  continueHref: '/lobby?tab=a',
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
        page.includes('aria-disabled="'),
      ],
      expected: [true, true, true, true, false, false],
    });
  });

  test('continuing without a passkey is a plain link to the destination', () => {
    const page = renderToString(h(SavePasskey, props()));
    assert({
      given: 'the shared-computer and not-now choices',
      should: 'link both to the destination, so they work without JavaScript',
      actual: page.match(/<a [^>]*href="\/lobby\?tab=a"/g)?.length,
      expected: 2,
    });
  });

  test('locks the choices while the device prompt is open', () => {
    const page = renderToString(h(SavePasskey, props({ pending: true })));
    assert({
      given: 'a pending save',
      should: 'say so, disable the save and mark both links unavailable',
      actual: [
        page.includes('Waiting for your device…'),
        page.match(/disabled=""/g)?.length,
        page.match(/aria-disabled="true"/g)?.length,
      ],
      expected: [true, 1, 2],
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
