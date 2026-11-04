import { assert, setupRitewayBun, test } from 'riteway/bun';
import { PRIVACY_CONTACT } from './contact';

setupRitewayBun();

test('the privacy contact is real', () => {
  assert({
    given: 'Watch open to the public, and the privacy contact',
    should: 'never be a placeholder',
    actual: PRIVACY_CONTACT.startsWith('['),
    expected: false,
  });
});
