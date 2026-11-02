import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { notifyAction } from './notify';

setupRitewayBun();

describe('notifyAction', () => {
  test('sends a visitor to sign in and back to the explainer', () => {
    assert({
      given: 'a signed-out visitor on the watch explainer',
      should: 'link to sign-in returning to the explainer',
      actual: notifyAction('watch', false),
      expected: {
        kind: 'sign-in',
        href: '/sign-in?next=%2Fcoming-soon%2Fwatch',
      },
    });
  });

  test('gives a signed-in member a sample action', () => {
    assert({
      given: 'a signed-in member',
      should: 'answer on the same page without sending them to sign in',
      actual: notifyAction('watch', true).kind,
      expected: 'sample',
    });
  });
});
