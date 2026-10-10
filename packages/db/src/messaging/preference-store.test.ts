import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { messagingAuthorityWire } from './channel-wire.test-support';
import { createMessagingPreferenceStore } from './preference-store';
setupRitewayBun();
test('dedicated preference methods select explicit read and update fences in the same canonical authority transaction', async () => {
  const selections = {
    following: true,
    hidden: false,
    notificationLevel: 'all' as const,
  };
  const f = messagingAuthorityWire([
    [[true, false, 'all', 4]],
    [[true, false, 'all', 4]],
    [[0]],
    [[1, '5']],
    [],
  ]);
  const operations: unknown[] = [];
  const store = createMessagingPreferenceStore(f.database, {
    read: async (tx, scope, frame) => {
      operations.push(['read', scope, frame.fact.channelId, typeof tx.execute]);
    },
    update: async (tx, scope, frame) => {
      operations.push([
        'update',
        scope,
        frame.fact.channelId,
        typeof tx.execute,
      ]);
    },
    clear: async () => {
      throw new Error('Unexpected clear');
    },
  });
  const value = await store.update(f.scope, selections);
  assert({
    given: 'an explicit update followed by its authorized metadata projection',
    should:
      'call separate canonical capabilities after account/pair/channel discovery and preserve actual read progress',
    actual: [
      value,
      operations,
      f.queries.slice(4).map(({ query }) => query.split(' ')[0]),
    ],
    expected: [
      { state: { ...selections, readSequence: 4 }, unread: 0 },
      [
        ['update', f.scope, f.scope.channelId, 'function'],
        ['read', f.scope, f.scope.channelId, 'function'],
      ],
      ['insert', 'select', 'select', 'insert', 'select'],
    ],
  });
});
test('a read capability cannot authorize preference writes when current update authority refuses', async () => {
  const f = messagingAuthorityWire([]);
  const called: string[] = [];
  const store = createMessagingPreferenceStore(f.database, {
    read: async () => {
      called.push('read');
      throw createAppError('NOT_FOUND');
    },
    update: async () => {
      called.push('update');
      throw createAppError('AUTHORIZATION');
    },
    clear: async () => {
      throw new Error('Unexpected clear');
    },
  });
  await assertRejects({
    given: 'refused current update authority',
    should:
      'invoke update rather than the weaker read fence and leave the driver unwritten',
    actual: () =>
      store.update(f.scope, {
        following: true,
        hidden: false,
        notificationLevel: 'none',
      }),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'canonical account and channel locks already acquired',
    should: 'not inspect or change protected actor state on refusal',
    actual: [called, f.queries.length],
    expected: [['update'], 4],
  });
});
