import { assert, setupRitewayBun, test } from 'riteway/bun';
import { launched } from '../coming-soon/launch';
import { PRIVACY_CONTACT } from './contact';

setupRitewayBun();

test('Watch opens only with a real privacy contact', () => {
  assert({
    given: 'the launch flag and the privacy contact',
    should: 'refuse opening Watch while the contact is a placeholder',
    actual: launched.watch && PRIVACY_CONTACT.startsWith('['),
    expected: false,
  });
});
