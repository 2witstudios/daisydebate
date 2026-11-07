import { assert, setupRitewayBun, test } from 'riteway/bun';
import { floorPagedHistory } from './paged-history';
setupRitewayBun();
const channelId = 'c'.repeat(24);
const message = (id: string, sequence: number) => ({
  id,
  channelId,
  sequence,
  changeVersion: sequence,
  authorActorId: 'a'.repeat(24),
  text: 'Old protected text',
  createdAt: '2026-11-06T00:00:00.000Z',
  editedAt: null,
  reactions: [],
});
const latest = {
  version: 1 as const,
  channelId,
  changeVersion: 102,
  messages: [message('m'.repeat(24), 102)],
  nextBefore: { channelId, sequence: 102 },
};
const older = {
  changeVersion: 102,
  messages: [message('o'.repeat(24), 1)],
  before: null,
};
test('an unseen removal withdraws older page text and resets pagination', () => {
  assert({
    given:
      'an older message outside the latest page, followed by a live removal revision',
    should:
      'withdraw stale protected history until reread and offer the latest protected cursor',
    actual: [
      floorPagedHistory(latest, older).messages.length,
      floorPagedHistory({ ...latest, changeVersion: 103 }, older),
    ],
    expected: [2, { messages: latest.messages, before: 102 }],
  });
});
