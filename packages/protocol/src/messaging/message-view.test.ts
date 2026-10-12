import { assert, setupRitewayBun, test } from 'riteway/bun';
import { messagingMessageView } from './message-view';
setupRitewayBun();
test('shared message mapping discloses only permitted content fields', () => {
  const record = {
    id: 'a'.repeat(24),
    channelId: 'b'.repeat(24),
    authorActorId: 'c'.repeat(24),
    sequence: 1,
    changeVersion: 2,
    text: 'hello',
    createdAt: '2026-10-12T00:00:00.000Z',
    editedAt: null,
    removedAt: null,
    commandId: 'private-command',
    ownReaction: true,
  };
  const expected = {
    id: record.id,
    channelId: record.channelId,
    authorActorId: record.authorActorId,
    sequence: 1,
    changeVersion: 2,
    text: 'hello',
    createdAt: record.createdAt,
    editedAt: null,
  };
  assert({
    given: 'restricted current message rows with accidental private fields',
    should: 'map explicit disclosed fields and erase all content on removal',
    actual: [
      messagingMessageView(record),
      messagingMessageView({ ...record, removedAt: record.createdAt }),
    ],
    expected: [
      expected,
      {
        id: record.id,
        channelId: record.channelId,
        sequence: 1,
        changeVersion: 2,
        unavailable: true,
      },
    ],
  });
});
