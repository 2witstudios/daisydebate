import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { changesPage, historyPage } from './read-frame';
setupRitewayBun();
const channelId = 'c'.repeat(24),
  actorId = 'a'.repeat(24);
test('a page takes its high-water mark from the same statement as its rows (MSG-2.2-arch1)', async () => {
  const empty = [{ message: null, changeVersion: 5 }];
  await assertRejects({
    given: 'a changes cursor beyond the snapshot’s high-water mark',
    should: 'refuse the future cursor',
    actual: async () => changesPage(empty, 2, 6, channelId),
    code: 'VALIDATION',
  });
  assert({
    given: 'a channel with no message in the snapshot',
    should: 'answer the snapshot’s own version with an empty page',
    actual: [
      historyPage(empty, 2, channelId),
      changesPage(empty, 2, 5, channelId),
    ],
    expected: [
      { messages: [], ownReactions: [], changeVersion: 5, nextBefore: null },
      {
        messages: [],
        changeVersion: 5,
        nextAfter: { channelId, changeVersion: 5 },
      },
    ],
  });
});
test('a history page keeps own reactions apart from its shared counts', () => {
  const page = historyPage(
    [
      {
        message: {
          id: 'm'.repeat(24),
          channelId,
          authorActorId: actorId,
          sequence: 2,
          changeVersion: 2,
          text: 'Live',
          replyToMessageId: null,
          createdAt: new Date('2026-10-09T18:00:00Z'),
          editedAt: null,
          removedAt: null,
        },
        changeVersion: 3,
        reactions: [
          { reaction: 'A', count: 2, own: true },
          { reaction: 'B', count: 1, own: false },
        ],
      },
      {
        message: {
          id: 'n'.repeat(24),
          channelId,
          authorActorId: actorId,
          sequence: 1,
          changeVersion: 1,
          text: null,
          replyToMessageId: null,
          createdAt: new Date('2026-10-09T18:00:00Z'),
          editedAt: null,
          removedAt: new Date('2026-10-09T18:00:01Z'),
        },
        changeVersion: 3,
        reactions: [{ reaction: 'A', count: 1, own: true }],
      },
    ],
    2,
    channelId,
  );
  assert({
    given: 'a live and a removed message the reader reacted to',
    should: 'share counts only, and own marks only for the live one',
    actual: [
      page.messages.map((message) => message.reactions),
      page.ownReactions,
    ],
    expected: [
      [
        [
          { reaction: 'A', count: 2 },
          { reaction: 'B', count: 1 },
        ],
        [],
      ],
      [{ messageId: 'm'.repeat(24), reactions: ['A'] }],
    ],
  });
});
