import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contextChatIdle } from '../../features/messaging/context-chat/form-state';
import { ContextChatMessages } from './chat-messages';

setupRitewayBun();
const action = async () => contextChatIdle('r'.repeat(24));
const actorId = 'a'.repeat(24),
  peerId = 'b'.repeat(24),
  strangerId = 'e'.repeat(24),
  channelId = 'c'.repeat(24);
const message = (sequence: number, authorActorId: string, text: string) => ({
  id: String(sequence).padStart(24, 'm'),
  channelId,
  authorActorId,
  text,
  sequence,
  changeVersion: sequence,
  createdAt: '2026-11-12T00:00:00.000Z',
  editedAt: null,
  reactions: [],
});
const props = {
  channelId,
  actorId,
  label: 'Room chat messages',
  unnamedAuthor: 'A member',
  idPrefix: 'room-chat',
  returnFocusId: 'room-chat-message',
  messages: [
    message(1, actorId, 'Mine'),
    message(2, peerId, 'Theirs'),
    message(3, strangerId, 'Unlabelled'),
  ],
  authors: [{ actorId: peerId, label: 'grace' }],
  hidden: false,
  locked: false,
  maxUnits: 4000,
  mutateAction: action,
  reportAction: action,
  refresh: () => {},
};
const names = (html: string) =>
  [...html.matchAll(/<p class="font-strong">(.*?)<\/p>/g)].map((match) =>
    match[1]!.replace(/<[^>]+>|<!-- -->/g, ''),
  );

test('a thread names each author and nothing more by default', () => {
  const html = renderToString(h(ContextChatMessages, props));
  assert({
    given: 'own, labelled and unlabelled authors with no page label',
    should:
      'show You, the username and the context’s words for an unnamed author, in order, under the list’s name',
    actual: [names(html), html.includes('aria-label="Room chat messages"')],
    expected: [['You', 'grace', 'A member'], true],
  });
});

test('a thread shows what the page says about an author beside their name', () => {
  const html = renderToString(
    h(ContextChatMessages, {
      ...props,
      authorLabel: (id: string) =>
        id === actorId
          ? 'Affirmative 1 · host'
          : id === peerId
            ? 'Judge'
            : null,
    }),
  );
  assert({
    given: 'a page that may name two of the three authors’ seats',
    should:
      'add the seat to those two and leave the third exactly as a member with none',
    actual: names(html),
    expected: ['You · Affirmative 1 · host', 'grace · Judge', 'A member'],
  });
});

test('a thread mints its form ids under its own prefix', () => {
  const html = renderToString(h(ContextChatMessages, props));
  assert({
    given: 'a Room chat thread with an own message',
    should: 'name the edit field for that chat, never another’s',
    actual: [
      html.includes(`id="room-chat-edit-${props.messages[0]!.id}"`),
      html.includes('floor-'),
    ],
    expected: [true, false],
  });
});
