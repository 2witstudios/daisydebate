import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoomInvite } from './room-invite';

setupRitewayBun();
test('private room invite keeps an actual room link and existing access requirement', () => {
  const html = renderToStaticMarkup(
    <RoomInvite roomId={'i'.repeat(24)} visibility="private" />,
  );
  assert({
    given: 'a private room link before hydration',
    should:
      'offer a native invite disclosure and usable link without claiming an access grant',
    actual: [
      html.includes('<summary'),
      html.includes(`href="/rooms/${'i'.repeat(24)}"`),
      html.includes('Existing room access is required.'),
      html.includes('<noscript>'),
    ],
    expected: [true, true, true, true],
  });
});
