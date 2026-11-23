import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contextChatIdle } from '../../features/messaging/context-chat/form-state';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { RoomChat } from './room-chat';

setupRitewayBun();
const action = async () => contextChatIdle('r'.repeat(24));
const props = {
  roomId: 'd'.repeat(24),
  actorId: 'a'.repeat(24),
  requestId: 'r'.repeat(24),
  socketUrl: null,
  readOnlyHint: false,
  sendAction: action,
  mutateAction: action,
  reportAction: action,
};

/** Whether the chat offers a message field: a text box, or a form to post one (a form has no role until named). */
const composer = (view: ReturnType<typeof renderAccessible>) => [
  view.count('textbox'),
  view.get('region', 'Room chat').getElementsByTagName('form').length,
];

test('Room chat names itself and nothing more', () => {
  const view = renderAccessible(h(RoomChat, props));
  assert({
    given: 'the Room chat a Room page mounts',
    should:
      'render one labelled region with its heading and no audience line, under none of the floor’s words',
    actual: [
      view.count('region', 'Room chat'),
      view.has('heading', 'Room chat', { level: 2 }),
      !view.textContent().includes('Everyone in the room'),
      view.textContent().includes('Loading Room chat…'),
      /Round|floor|Debaters and host/.test(view.textContent()),
    ],
    expected: [1, true, true, true, false],
  });
});

test('Room chat creates nothing and shows no composer before its channel is known', () => {
  const view = renderAccessible(h(RoomChat, props));
  assert({
    given: 'the first render, before discovery',
    should: 'offer no message field: only a found or opened channel has one',
    actual: composer(view),
    expected: [0, 0],
  });
});

test('a judge’s Room chat says why there is nowhere to write', () => {
  const view = renderAccessible(
    h(RoomChat, { ...props, readOnlyHint: true, reader: 'judge' }),
  );
  assert({
    given: 'a Room chat whose judge may read and not post',
    should:
      'say that judges read and do not post, in the Room’s own words, with no message field',
    actual: [
      view
        .textContent()
        .includes('Judges read this chat but don’t post in it.'),
      view.textContent().includes('is read-only'),
      ...composer(view),
    ],
    expected: [true, false, 0, 0],
  });
});

test('a Youth Room spectator’s Room chat says only the people in it chat (decision 84)', () => {
  const view = renderAccessible(
    h(RoomChat, { ...props, readOnlyHint: true, reader: 'spectator' }),
  );
  assert({
    given: 'a seatless reader of a Youth Room’s chat',
    should:
      'say that only people in this Room can chat here, name no judge, age or ladder, and offer no message field',
    actual: [
      view.textContent().includes('Only people in this Room can chat here.'),
      /\bjudges?\b|under 18|\byouth\b|\bage\b/i.test(view.textContent()),
      ...composer(view),
    ],
    expected: [true, false, 0, 0],
  });
});

test('a read-only Room chat with no seat to name says so plainly', () => {
  const view = renderAccessible(h(RoomChat, { ...props, readOnlyHint: true }));
  assert({
    given:
      'a read-only Room chat whose reader the view names neither judge nor spectator',
    should: 'say the chat is read-only, blaming no seat',
    actual: [
      view.textContent().includes('This chat is read-only.'),
      view.textContent().includes('Only people in this Room'),
      view.textContent().includes('Judges read'),
    ],
    expected: [true, false, false],
  });
});
