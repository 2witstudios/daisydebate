import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttendanceSignedOutNotice } from './attendance-signed-out-notice';

setupRitewayBun();

test('a signed-out debater is told and offered sign-in back to the Round', () => {
  const html = renderToStaticMarkup(
    <AttendanceSignedOutNotice roundId={'a'.repeat(24)} />,
  );
  assert({
    given: 'check-in stopped on a 401',
    should: 'alert and link to sign-in returning to this Round',
    actual: {
      alert: html.includes('role="alert"'),
      link: html.includes(
        `href="/sign-in?next=${encodeURIComponent(`/rounds/${'a'.repeat(24)}`)}"`,
      ),
    },
    expected: { alert: true, link: true },
  });
});
