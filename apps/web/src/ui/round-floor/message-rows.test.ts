import { assert, setupRitewayBun, test } from 'riteway/bun';
import { floorMessageRows } from './message-rows';
setupRitewayBun();
const actorId = 'a'.repeat(24),
  channelId = 'c'.repeat(24);
const own = {
  id: 'm'.repeat(24),
  channelId,
  authorActorId: actorId,
  text: 'Own original',
  sequence: 1,
  changeVersion: 1,
  createdAt: '2026-11-06T00:00:00.000Z',
  editedAt: null,
  reactions: [],
};
const peer = {
  ...own,
  id: 'p'.repeat(24),
  authorActorId: 'b'.repeat(24),
  text: 'Protected peer text',
  sequence: 2,
  changeVersion: 2,
};
test('withdrawing older history retains only an opened own control anchor', () => {
  const rows = floorMessageRows({
    actorId,
    channelId,
    messages: [],
    held: [own, peer],
  });
  assert({
    given: 'older pages withdrawn after a live change',
    should:
      'keep the own form keyed in place without any protected body or peer control',
    actual: rows.map((row) => [row.id, row.body, row.control?.text]),
    expected: [[own.id, null, own.text]],
  });
});
test('a protected reread restores the same own row identity with current canonical text', () => {
  const rows = floorMessageRows({
    actorId,
    channelId,
    messages: [{ ...own, text: 'Canonical edit', changeVersion: 3 }],
    held: [own],
  });
  assert({
    given: 'a protected reread after withdrawal',
    should: 'keep the row key while supplying current canonical input',
    actual: rows.map((row) => [
      row.id,
      row.body && !('unavailable' in row.body) ? row.body.text : null,
      row.control?.text,
    ]),
    expected: [[own.id, 'Canonical edit', 'Canonical edit']],
  });
});
test('own draft anchors cannot cross actor or channel scopes', () => {
  assert({
    given: 'cached controls from a different principal or channel',
    should: 'never retain those controls',
    actual: [
      floorMessageRows({
        actorId: 'z'.repeat(24),
        channelId,
        messages: [],
        held: [own],
      }),
      floorMessageRows({
        actorId,
        channelId: 'x'.repeat(24),
        messages: [],
        held: [own],
      }),
    ],
    expected: [[], []],
  });
});
test('confirmed removal keeps an owned anchor locked without resurrecting the old body', () => {
  const removed = {
    id: own.id,
    channelId,
    sequence: 1,
    changeVersion: 4,
    unavailable: true as const,
  };
  const row = floorMessageRows({
    actorId,
    channelId,
    messages: [removed],
    held: [own],
  })[0];
  assert({
    given: 'a canonical tombstone for an opened own editor',
    should: 'keep the control identity while the only body is unavailable',
    actual: [row?.id, row?.body, row?.control?.id],
    expected: [own.id, removed, own.id],
  });
});
