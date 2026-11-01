import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SignOutForm } from './sign-out-form';

setupRitewayBun();

test('the native sign-out form owns the browser cleanup handler', () => {
  const form = SignOutForm({ next: '/settings', className: '' });
  assert({
    given: 'the sign-out control submitted by button or keyboard',
    should: 'attach cleanup to the form while retaining its native POST',
    actual: [form.props.method, form.props.action, typeof form.props.onSubmit],
    expected: ['post', '/auth/sign-out', 'function'],
  });
});
