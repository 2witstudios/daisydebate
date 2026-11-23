import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { AttendanceSignedOutNotice } from './attendance-signed-out-notice';

setupRitewayBun();

test('a signed-out debater is told and offered sign-in back to the Round', () => {
  const view = renderAccessible(
    <AttendanceSignedOutNotice roundId={'a'.repeat(24)} />,
  );
  assert({
    given: 'check-in stopped on a 401',
    should: 'alert and link to sign-in returning to this Round',
    actual: {
      alert: view.has('alert'),
      link: view.within('alert').attribute('link', 'Sign in again', 'href'),
    },
    expected: {
      alert: true,
      link: `/sign-in?next=${encodeURIComponent(`/rounds/${'a'.repeat(24)}`)}`,
    },
  });
});
