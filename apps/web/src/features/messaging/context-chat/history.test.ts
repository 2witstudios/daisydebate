import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mergeContextChatMessages, contextChatUnread } from './history';

setupRitewayBun();
const channelId = 'c'.repeat(24);
const message = (sequence: number, changeVersion = sequence) => ({
  id: String(sequence).padStart(24, 'm'),
  channelId,
  sequence,
  changeVersion,
  authorActorId: 'a'.repeat(24),
  text: `message ${sequence}`,
  createdAt: '2026-11-07T00:00:00.000Z',
  editedAt: null,
  reactions: [],
});
test('a live chat revision supersedes older pagination without duplicates or resurrection', () => {
  const removed = {
    id: message(2).id,
    channelId,
    sequence: 2,
    changeVersion: 4,
    unavailable: true as const,
  };
  const merged = mergeContextChatMessages(
    channelId,
    [message(2), message(1)],
    [message(3), removed],
  );
  assert({
    given: 'an older page and a live removal of an overlapping message',
    should: 'keep canonical order and removal and include each ID once',
    actual: merged,
    expected: [message(3), removed, message(1)],
  });
});
test('chat pages cannot introduce another channel', () => {
  const merged = mergeContextChatMessages(
    channelId,
    [message(1)],
    [{ ...message(2), channelId: 'f'.repeat(24) }],
  );
  assert({
    given: 'a page belonging to a different conversation',
    should: 'exclude its content from this chat',
    actual: merged,
    expected: [message(1)],
  });
});
test('unread chat counts ignore own and unavailable messages', () => {
  const removed = {
    id: message(4).id,
    channelId,
    sequence: 4,
    changeVersion: 4,
    unavailable: true as const,
  };
  assert({
    given: 'a prior read marker, an own message, a peer message and a removal',
    should: 'count only available unread peer text',
    actual: contextChatUnread(
      [
        message(1),
        { ...message(2), authorActorId: 's'.repeat(24) },
        message(3),
        removed,
      ],
      1,
      's'.repeat(24),
    ),
    expected: 1,
  });
});
