import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contextChatIdle } from '../features/messaging/context-chat/form-state';
import { renderMarkup } from '../test-support/rendered/markup';
import { RoomChat } from '../ui/room-chat/room-chat';

setupRitewayBun();
const action = async () => contextChatIdle('r'.repeat(24));

// Markup contract: filling the container's height is carried only by the
// layout classes (h-full, min-h-0, flex-1, overflow-y-auto), which have no
// accessible equivalent to assert.
test('Room chat fills the height its container gives it', () => {
  const html = renderMarkup(
    h(RoomChat, {
      roomId: 'd'.repeat(24),
      actorId: 'a'.repeat(24),
      requestId: 'r'.repeat(24),
      socketUrl: null,
      readOnlyHint: false,
      sendAction: action,
      mutateAction: action,
      reportAction: action,
    }),
  );
  assert({
    given: 'a container of a fixed height',
    should:
      'be a full-height column that may shrink, around a thread that takes the rest and scrolls inside',
    actual: [
      html.startsWith('<div class="flex h-full min-h-0 flex-1 flex-col">'),
      html.includes(
        '<section aria-label="Room chat" class="flex min-h-0 flex-1 flex-col">',
      ),
      html.includes('flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto'),
    ],
    expected: [true, true, true],
  });
});
