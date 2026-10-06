import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  appendMessage,
  markRead,
  totalUnread,
  unreadByChannel,
  unreadCount,
  type ChatMessage,
} from './chat';

setupRitewayBun();

const message = (
  id: string,
  channelId: string,
  authorId: string,
  sentAt: string,
  text = 'hi',
): ChatMessage => ({
  id,
  channelId,
  author: { id: authorId, name: authorId, role: 'debater' },
  text,
  sentAt,
});

const t1 = '2026-10-05T12:00:00.000Z';
const t2 = '2026-10-05T12:01:00.000Z';
const t3 = '2026-10-05T12:02:00.000Z';
const messages = [
  message('m1', 'round', 'judge', t1),
  message('m2', 'round', 'me', t2),
  message('m3', 'round', 'opp', t3),
  message('m4', 'club', 'coach', t2),
];

describe('unreadCount', () => {
  test('counting', () => {
    assert({
      given: 'a channel never read',
      should: 'count every message from others',
      actual: unreadCount(messages, 'round', null, 'me'),
      expected: 2,
    });
    assert({
      given: 'a read marker',
      should: 'count only later messages from others',
      actual: unreadCount(messages, 'round', t2, 'me'),
      expected: 1,
    });
  });
});

describe('unreadByChannel and totalUnread', () => {
  test('per channel', () => {
    const counts = unreadByChannel(
      messages,
      [
        { id: 'round', title: 'Round', scope: 'round' },
        { id: 'club', title: 'Club', scope: 'club' },
      ],
      { club: t3 },
      'me',
    );
    assert({
      given: 'one read channel and one unread channel',
      should: 'count each channel',
      actual: counts,
      expected: { round: 2, club: 0 },
    });
    assert({
      given: 'per-channel counts',
      should: 'sum them',
      actual: totalUnread(counts),
      expected: 2,
    });
  });
});

describe('markRead', () => {
  test('marker', () => {
    const markers = { club: t1 };
    assert({
      given: 'a channel read now',
      should: 'set its marker without touching others',
      actual: markRead(markers, 'round', t3),
      expected: { club: t1, round: t3 },
    });
  });
});

describe('appendMessage', () => {
  test('accepting and rejecting', () => {
    const next = message('m5', 'round', 'me', t3, '  good round  ');
    assert({
      given: 'a padded message',
      should: 'append it trimmed',
      actual: appendMessage(messages, next, 20).at(-1),
      expected: { ...next, text: 'good round' },
    });
    assert({
      given: 'a blank message',
      should: 'return the messages unchanged',
      actual: appendMessage(messages, { ...next, text: '   ' }, 20),
      expected: messages,
    });
    assert({
      given: 'a message over the limit',
      should: 'return the messages unchanged',
      actual: appendMessage(messages, { ...next, text: 'x'.repeat(21) }, 20),
      expected: messages,
    });
    assert({
      given: 'a message whose id is already present',
      should: 'return the messages unchanged',
      actual: appendMessage(messages, { ...next, id: 'm1' }, 20),
      expected: messages,
    });
  });
});
