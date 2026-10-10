import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type {
  MessagingChannelStore,
  MessagingLockedFrame,
  MessagingMessageRecord,
} from '@daisy/db/messaging';
import { createMessagingReadOperations } from './read';
import { typingWorld } from './typing.test-support';
setupRitewayBun();
function readWire() {
  const f = typingWorld(),
    account = f.accounts[0]!.account;
  const principal = {
    kind: 'user' as const,
    actorId: account.actorId,
    userId: account.userId,
  };
  const messages: MessagingMessageRecord[] = [
    {
      id: 'm'.repeat(24),
      sequence: 9,
      changeVersion: 11,
      text: 'Current reply',
      editedAt: null,
      removedAt: null,
      replyToMessageId: 'r'.repeat(24),
    },
    {
      id: 'n'.repeat(24),
      sequence: 2,
      changeVersion: 12,
      text: 'Edited history',
      editedAt: f.now,
      removedAt: null,
    },
    {
      id: 'p'.repeat(24),
      sequence: 3,
      changeVersion: 13,
      text: 'Private removed text',
      editedAt: null,
      removedAt: f.now,
      replyToMessageId: 'q'.repeat(24),
    },
  ].map((row) => ({
    ...row,
    authorActorId: account.actorId,
    channelId: f.channel.channelId,
    createdAt: f.now,
  }));
  const calls: unknown[] = [];
  const forbid = async () => {
    throw new Error('Read projection cannot invoke a mutation');
  };
  const frame: MessagingLockedFrame = {
    fact: f.channel,
    accounts: f.accounts.map((row) => row.account),
    counters: {
      channelId: f.channel.channelId,
      messageSequence: 9,
      changeVersion: 20,
    },
    authorize: forbid,
    readSendState: forbid,
    commitSend: forbid,
    readMutationState: forbid,
    commitMutation: forbid,
    history: async (query) => {
      calls.push(['history', query]);
      return {
        messages: [messages[0]!, messages[2]!, messages[1]!],
        changeVersion: 20,
        nextBefore: { channelId: f.channel.channelId, sequence: 2 },
      };
    },
    changes: async (query) => {
      calls.push(['changes', query]);
      return {
        messages,
        changeVersion: 20,
        nextAfter: { channelId: f.channel.channelId, changeVersion: 20 },
      };
    },
    markRead: async (sequence) => {
      calls.push(['markRead', sequence]);
      return 7;
    },
  };
  const store: MessagingChannelStore = {
    withChannel: async (scope, work) => {
      calls.push(['scope', scope]);
      return work(frame);
    },
  };
  return {
    f,
    principal,
    calls,
    operation: createMessagingReadOperations({
      bounds: { messageUnits: 100, pageItems: 10 },
      store,
    }),
  };
}
test('history and search preserve protected adapter scope while removed records expose only unavailable cursor metadata', async () => {
  const { f, principal, calls, operation } = readWire();
  const input = {
    version: 1,
    channelId: f.channel.channelId,
    limit: 3,
    before: { channelId: f.channel.channelId, sequence: 10 },
  };
  const history = await operation.history(input, principal);
  const search = await operation.search(
    { ...input, query: 'history' },
    principal,
  );
  const scope = {
    channelId: f.channel.channelId,
    userId: principal.userId,
    actorId: principal.actorId,
  };
  assert({
    given:
      'scoped adapter records containing a reply, an edit and removed private text',
    should:
      'forward validated pagination/search and omit all removed body/author/reply fields',
    actual: [
      calls,
      history.messages[1],
      history.messages[0],
      search.nextBefore,
    ],
    expected: [
      [
        ['scope', scope],
        ['history', { limit: 3, before: 10 }],
        ['scope', scope],
        ['history', { limit: 3, before: 10, query: 'history' }],
      ],
      {
        id: 'p'.repeat(24),
        channelId: f.channel.channelId,
        sequence: 3,
        changeVersion: 13,
        unavailable: true,
      },
      {
        id: 'm'.repeat(24),
        channelId: f.channel.channelId,
        authorActorId: principal.actorId,
        sequence: 9,
        changeVersion: 11,
        text: 'Current reply',
        createdAt: f.now,
        editedAt: null,
        replyToMessageId: 'r'.repeat(24),
      },
      { channelId: f.channel.channelId, sequence: 2 },
    ],
  });
});
test('change classification uses actual edits and permits the final cursor beyond the last message after authority-only changes', async () => {
  const { f, principal, calls, operation } = readWire();
  const result = await operation.changes(
    {
      version: 1,
      channelId: f.channel.channelId,
      limit: 3,
      after: { channelId: f.channel.channelId, changeVersion: 10 },
    },
    principal,
  );
  const read = await operation.markRead(
    {
      version: 1,
      channelId: f.channel.channelId,
      cursor: { channelId: f.channel.channelId, sequence: 5 },
    },
    principal,
  );
  assert({
    given:
      'created sequence9/version11, an edited message, removal and authority-only versions through20',
    should:
      'preserve classification, hide removed text and return the adapter monotonic cursor rather than request sequence',
    actual: [
      result.changes.map((change) => change.kind),
      result.changes[2],
      result.nextAfter,
      read,
      calls.filter((call) => Array.isArray(call) && call[0] !== 'scope'),
    ],
    expected: [
      ['created', 'edited', 'removed'],
      {
        kind: 'removed',
        channelId: f.channel.channelId,
        messageId: 'p'.repeat(24),
        changeVersion: 13,
      },
      { channelId: f.channel.channelId, changeVersion: 20 },
      { version: 1, channelId: f.channel.channelId, sequence: 7 },
      [
        ['changes', { limit: 3, after: 10 }],
        ['markRead', 5],
      ],
    ],
  });
});
test('foreign cursors and anonymous readers refuse before the protected store boundary', async () => {
  const { f, principal, calls, operation } = readWire();
  for (const method of ['history', 'search', 'changes', 'markRead'] as const) {
    const foreign = {
      channelId: 'x'.repeat(24),
      sequence: 1,
      changeVersion: 1,
    };
    const input =
      method === 'markRead'
        ? {
            version: 1,
            channelId: f.channel.channelId,
            cursor: { channelId: foreign.channelId, sequence: 1 },
          }
        : method === 'changes'
          ? {
              version: 1,
              channelId: f.channel.channelId,
              limit: 1,
              after: { channelId: foreign.channelId, changeVersion: 1 },
            }
          : {
              version: 1,
              channelId: f.channel.channelId,
              limit: 1,
              before: { channelId: foreign.channelId, sequence: 1 },
              ...(method === 'search' ? { query: 'history' } : {}),
            };
    await assertRejects({
      given: `foreign ${method} cursor`,
      should: 'refuse before reading the channel',
      actual: () => operation[method](input, principal),
      code: 'VALIDATION',
    });
  }
  await assertRejects({
    given: 'anonymous history request',
    should: 'refuse before resource access',
    actual: () =>
      operation.history(
        { version: 1, channelId: f.channel.channelId, limit: 1 },
        { kind: 'anonymous' },
      ),
    code: 'AUTHENTICATION',
  });
  assert({
    given: 'all invalid readers',
    should: 'leave the store untouched',
    actual: calls,
    expected: [],
  });
});
