import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoomInvite } from './room-invite';

setupRitewayBun();
test('invite renders an actual room link before hydration', () => {
  const html = renderToStaticMarkup(
    <RoomInvite
      roomId={'i'.repeat(24)}
      visibility="private"
      label="Copy invite link"
    />,
  );
  assert({
    given: 'a private room before hydration',
    should: 'offer the room link itself, labelled, without a dead copy button',
    actual: [
      html.includes(`href="/rooms/${'i'.repeat(24)}"`),
      html.includes('>Copy invite link</a>'),
      html.includes('<button'),
    ],
    expected: [true, true, false],
  });
});
