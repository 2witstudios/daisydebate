import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { RoomInvite } from './room-invite';

setupRitewayBun();
test('invite renders an actual room link before hydration', () => {
  const view = renderAccessible(
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
      view.attribute('link', 'Copy invite link', 'href'),
      view.count('button'),
    ],
    expected: [`/rooms/${'i'.repeat(24)}`, 0],
  });
});
