import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contextChatIdle } from '../../features/messaging/context-chat/form-state';
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

test('Room chat names itself and nothing more', () => {
  const html = renderToString(h(RoomChat, props));
  assert({
    given: 'the Room chat a Room page mounts',
    should:
      'render one labelled region with its heading and no audience line, under none of the floor’s words',
    actual: [
      (html.match(/aria-label="Room chat"/g) ?? []).length,
      html.includes('<h2 class="font-strong">Room chat</h2>'),
      !html.includes('Everyone in the room'),
      html.includes('Loading Room chat…'),
      /Round|floor|Debaters and host/.test(html),
    ],
    expected: [1, true, true, true, false],
  });
});

test('Room chat fills the height its container gives it', () => {
  const html = renderToString(h(RoomChat, props));
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

test('Room chat creates nothing and shows no composer before its channel is known', () => {
  const html = renderToString(h(RoomChat, props));
  assert({
    given: 'the first render, before discovery',
    should: 'offer no message field: only a found or opened channel has one',
    actual: [html.includes('<textarea'), html.includes('<form')],
    expected: [false, false],
  });
});

test('a judge’s Room chat says why there is nowhere to write', () => {
  const html = renderToString(
    h(RoomChat, { ...props, readOnlyHint: true, reader: 'judge' }),
  );
  assert({
    given: 'a Room chat whose judge may read and not post',
    should:
      'say that judges read and do not post, in the Room’s own words, with no message field',
    actual: [
      html.includes('Judges read this chat but don’t post in it.'),
      html.includes('is read-only'),
      html.includes('<textarea'),
      html.includes('<form'),
    ],
    expected: [true, false, false, false],
  });
});

test('a Youth Room spectator’s Room chat says only the people in it chat (decision 84)', () => {
  const html = renderToString(
    h(RoomChat, { ...props, readOnlyHint: true, reader: 'spectator' }),
  );
  assert({
    given: 'a seatless reader of a Youth Room’s chat',
    should:
      'say that only people in this Room can chat here, name no judge, age or ladder, and offer no message field',
    actual: [
      html.includes('Only people in this Room can chat here.'),
      /\bjudges?\b|under 18|\byouth\b|\bage\b/i.test(html),
      html.includes('<textarea'),
      html.includes('<form'),
    ],
    expected: [true, false, false, false],
  });
});

test('a read-only Room chat with no seat to name says so plainly', () => {
  const html = renderToString(h(RoomChat, { ...props, readOnlyHint: true }));
  assert({
    given:
      'a read-only Room chat whose reader the view names neither judge nor spectator',
    should: 'say the chat is read-only, blaming no seat',
    actual: [
      html.includes('This chat is read-only.'),
      html.includes('Only people in this Room'),
      html.includes('Judges read'),
    ],
    expected: [true, false, false],
  });
});
